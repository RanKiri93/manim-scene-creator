import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Stage, Layer, Group, Rect, Text, Line as KonvaLine } from 'react-konva';
import { useSceneStore } from '@/store/useSceneStore';
import {
  usePreviewMergedItems,
  usePreviewOps,
  type PreviewOp,
} from '@/agent/previewSelectors';
import GridLayer from './layers/GridLayer';
import TextLineNode from './layers/TextLineNode';
import ShapeNode from './layers/ShapeNode';
import ImageNode from './layers/ImageNode';
import SurroundingRectNode from './layers/SurroundingRectNode';
import GraphNode from './layers/GraphNode';
import { useResolvedPositions } from './hooks/useResolvedPosition';
import { FRAME_W, FRAME_H } from '@/lib/constants';
import {
  isActiveAtTime,
  isTransformSourceHiddenInPreview,
} from '@/lib/time';
import {
  activeTextTransformForLine,
  exitPreviewForTarget,
  blinkPreviewForTarget,
  cameraPosePreviewAtTime,
  imageIntroOpacity,
  targetAnimPreviewAccum,
  lerpHexColor,
  type ExitPreviewState,
  type BlinkPreviewState,
} from '@/lib/visualPlaybackPreview';
import {
  graphGroupShouldRender,
  cumulativeAxesDrawOrder,
  cumulativeField,
  type GraphAxesDrawSlot,
} from '@/lib/graphPreview';
import { resolvePosition } from '@/lib/resolvePosition';
import { surroundPreviewBBoxManim } from '@/lib/surroundCanvasPreview';
import {
  canvasToWorldPoint,
  cameraViewportTransform,
  manimToCanvas,
  surroundBBoxCanvasCenter,
} from '@/lib/canvasManimCoords';
import {
  frameCenter,
  frameCenterById,
  frameDisplayName,
  readingOrderFrames,
} from '@/lib/frameGrid';
import type {
  AxesItem,
  ImageItem,
  ItemId,
  SceneItem,
  ShapeItem,
  SurroundingRectItem,
  TextLineItem,
} from '@/types/scene';
import { measuredInkBox, type SnapBox, type TextSnapGuide } from '@/lib/textSnap';
import { effectiveSnapPixelsPerUnit } from './hooks/useDragSnap';
import {
  logicalCameraFrameAtTime,
  resolveCameraSchedule,
  type CameraPose,
} from '@/lib/camera';
import { fitCameraObjectSnapshot } from '@/lib/cameraBounds';
import {
  CAMERA_FIT_REQUEST_EVENT,
  CAMERA_REGION_REQUEST_EVENT,
  cameraCaptureContextUnchanged,
  cameraRegionBoundsFromDrag,
  type CameraFitRequestEventDetail,
} from './hooks/useCameraRegionSelection';
import { createCameraMove } from '@/store/factories';
import { useProjectScenesStore } from '@/store/useProjectScenesStore';

type CameraAuthoringContext = {
  time: number;
  frameIds: string;
  startFrameId: ItemId;
  sceneId: string | null;
};

type RegionCaptureState = {
  context: CameraAuthoringContext;
  start: { x: number; y: number } | null;
  current: { x: number; y: number } | null;
};

type FitPreviewState = {
  context: CameraAuthoringContext;
  bounds: { left: number; right: number; bottom: number; top: number };
  destination: CameraPose;
  targetFrameId: ItemId;
  cameraId: string | null;
};

type SceneCanvasProps = {
  onFrameRectChange?: (rect: DOMRect) => void;
};

type GraphLayerState = {
  axes: AxesItem;
  drawOrder: GraphAxesDrawSlot[];
  field: ReturnType<typeof cumulativeField>;
  streamPlacementFieldId: ItemId | null;
  resolvedX: number;
  resolvedY: number;
  isSelected: boolean;
};

type CanvasEntry =
  | { kind: 'graph'; layer: number; graph: GraphLayerState }
  | { kind: 'text'; layer: number; item: TextLineItem }
  | { kind: 'shape'; layer: number; item: ShapeItem }
  | { kind: 'image'; layer: number; item: ImageItem }
  | {
      kind: 'surround';
      layer: number;
      item: SurroundingRectItem;
      bboxManim: { left: number; right: number; bottom: number; top: number };
    };

function selectionTouchesAxes(
  axesId: ItemId,
  selectedIds: Set<ItemId>,
  items: Map<ItemId, SceneItem>,
): boolean {
  if (selectedIds.has(axesId)) return true;
  for (const id of selectedIds) {
    const it = items.get(id);
    if (!it) continue;
    if (
      (it.kind === 'graphPlot' ||
        it.kind === 'graphCurve' ||
        it.kind === 'graphDot' ||
        it.kind === 'graphField' ||
        it.kind === 'graphFunctionSeries' ||
        it.kind === 'graphPointSequence' ||
        it.kind === 'graphArea') &&
      it.axesId === axesId
    ) {
      return true;
    }
  }
  return false;
}

function shiftBBoxManim(
  b: { left: number; right: number; bottom: number; top: number },
  dx: number,
  dy: number,
): { left: number; right: number; bottom: number; top: number } {
  return {
    left: b.left + dx,
    right: b.right + dx,
    bottom: b.bottom + dy,
    top: b.top + dy,
  };
}

function strokeAfterBlinkThenTa(
  baseStroke: string,
  blink: BlinkPreviewState | null,
  ta: ReturnType<typeof targetAnimPreviewAccum>,
): string | undefined {
  let s = baseStroke;
  if (
    blink != null &&
    blink.row.mode === 'color' &&
    blink.colorMix > 0
  ) {
    s = lerpHexColor(s, blink.blinkColor, blink.colorMix);
  }
  if (ta.strokeReplaceHex) s = ta.strokeReplaceHex;
  if (ta.colorLerpTo != null && (ta.colorLerpT ?? 0) > 1e-6) {
    s = lerpHexColor(s, ta.colorLerpTo, ta.colorLerpT!);
  }
  const changedByBlink =
    blink != null && blink.row.mode === 'color' && blink.colorMix > 0;
  const changedByTa =
    Boolean(ta.strokeReplaceHex) ||
    Boolean(ta.colorLerpTo && (ta.colorLerpT ?? 0) > 1e-6);
  return changedByBlink || changedByTa ? s : undefined;
}

export default function SceneCanvas({ onFrameRectChange }: SceneCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 450 });
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(true);
  const [renderLikePreview, setRenderLikePreview] = useState(false);
  const [boardView, setBoardView] = useState(false);
  const [snapText, setSnapText] = useState(true);
  const [snapGuides, setSnapGuides] = useState<{ itemId: ItemId; guides: TextSnapGuide[] } | null>(null);
  const [gridDivisions, setGridDivisions] = useState(16);
  // Editor-only viewport. 'follow' tracks the camera (start frame + camera_move
  // clips); 'free' lets the user pan around / jump to a frame while paused. This
  // never affects export.
  const [viewMode, setViewMode] = useState<'follow' | 'free'>('follow');
  const [freeOffset, setFreeOffset] = useState({ x: 0, y: 0 });
  const [freeWidth, setFreeWidth] = useState(FRAME_W);
  const [cameraAuthoringError, setCameraAuthoringError] = useState<string | null>(null);
  const [regionCapture, setRegionCapture] = useState<RegionCaptureState | null>(null);
  const [fitPreview, setFitPreview] = useState<FitPreviewState | null>(null);
  const panRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startOffset: { x: number; y: number };
  } | null>(null);
  const didPanRef = useRef(false);

  const currentTime = useSceneStore((s) => s.currentTime);
  const isPlaying = useSceneStore((s) => s.isPlaying);
  const activeSceneId = useProjectScenesStore((s) => s.activeSceneId);
  const audioItems = useSceneStore((s) => s.audioItems);
  const frames = useSceneStore((s) => s.frames);
  const startFrameId = useSceneStore((s) => s.startFrameId);
  const cameraObjectFitPadding = useSceneStore((s) => s.cameraObjectFitPadding);
  const itemsMap = usePreviewMergedItems();
  const committedItems = useSceneStore((s) => s.items);
  const previewOps = usePreviewOps();
  const selectedIds = useSceneStore((s) => s.selectedIds);
  const clearSelection = useSceneStore((s) => s.clearSelection);
  const polylinePointCaptureId = useSceneStore((s) => s.polylinePointCaptureId);
  const targetAnimationPathCapture = useSceneStore(
    (s) => s.targetAnimationPathCapture,
  );
  const updateItem = useSceneStore((s) => s.updateItem);
  const select = useSceneStore((s) => s.select);
  const deletedPreviewIds = useMemo(
    () => new Set([...previewOps].filter(([, op]) => op === 'delete').map(([id]) => id)),
    [previewOps],
  );
  const cameraPose = useMemo(
    () => cameraPosePreviewAtTime(currentTime, itemsMap, frames, startFrameId, deletedPreviewIds),
    [currentTime, itemsMap, frames, startFrameId, deletedPreviewIds],
  );
  const effectiveCameraPose = useMemo(
    () => isPlaying || viewMode === 'follow'
      ? cameraPose
      : { x: freeOffset.x, y: freeOffset.y, width: freeWidth },
    [isPlaying, viewMode, cameraPose, freeOffset, freeWidth],
  );
  const followTransform = useMemo(
    () => cameraViewportTransform(effectiveCameraPose, size.width, size.height),
    [effectiveCameraPose, size.width, size.height],
  );
  const frameOffsetForItem = useCallback(
    (item: SceneItem) =>
      frameCenterById(frames, 'frameId' in item ? item.frameId : startFrameId),
    [frames, startFrameId],
  );
  const boardTransform = useMemo(() => {
    if (!boardView || frames.length === 0) {
      return followTransform;
    }
    const boxes = frames.map((f) => {
      const c = frameCenter(f);
      return {
        left: c.x - FRAME_W / 2,
        right: c.x + FRAME_W / 2,
        bottom: c.y - FRAME_H / 2,
        top: c.y + FRAME_H / 2,
      };
    });
    const left = Math.min(...boxes.map((b) => b.left));
    const right = Math.max(...boxes.map((b) => b.right));
    const bottom = Math.min(...boxes.map((b) => b.bottom));
    const top = Math.max(...boxes.map((b) => b.top));
    const worldW = Math.max(FRAME_W, right - left);
    const worldH = Math.max(FRAME_H, top - bottom);
    const ppuX = size.width / FRAME_W;
    const ppuY = size.height / FRAME_H;
    const scale = Math.min(1, (size.width * 0.9) / (worldW * ppuX), (size.height * 0.9) / (worldH * ppuY));
    const cx = (left + right) / 2;
    const cy = (bottom + top) / 2;
    const base = manimToCanvas(cx, cy, size.width, size.height);
    return {
      x: size.width / 2 - scale * base.x,
      y: size.height / 2 - scale * base.y,
      scale,
    };
  }, [boardView, frames, size.width, size.height, followTransform]);
  const contentTransform = boardView ? boardTransform : followTransform;
  const authoringContext = useMemo<CameraAuthoringContext>(() => ({
    time: currentTime,
    frameIds: frames.map((frame) => frame.id).join('|'),
    startFrameId,
    sceneId: activeSceneId,
  }), [currentTime, frames, startFrameId, activeSceneId]);

  const addCameraMoveClip = useSceneStore((s) => s.addCameraMoveClip);
  const cancelCameraAuthoring = useCallback(() => {
    setRegionCapture(null);
    setFitPreview(null);
  }, []);

  const applyFitPreview = useCallback(() => {
    if (!fitPreview) return;
    if (!cameraCaptureContextUnchanged(fitPreview.context, authoringContext)) {
      setCameraAuthoringError('Camera fit cancelled because scene, time, or frames changed.');
      cancelCameraAuthoring();
      return;
    }
    const center = frameCenterById(frames, fitPreview.targetFrameId);
    const patch = {
      targetFrameId: fitPreview.targetFrameId,
      targetWidth: fitPreview.destination.width,
      offsetX: fitPreview.destination.x - center.x,
      offsetY: fitPreview.destination.y - center.y,
    };
    if (fitPreview.cameraId) {
      updateItem(fitPreview.cameraId, patch);
    } else {
      const clip = createCameraMove(fitPreview.targetFrameId, fitPreview.context.time, 1);
      clip.label = 'Zoom to object';
      Object.assign(clip, patch);
      addCameraMoveClip(clip);
    }
    setFitPreview(null);
    setCameraAuthoringError(null);
  }, [fitPreview, authoringContext, frames, updateItem, addCameraMoveClip, cancelCameraAuthoring]);

  useEffect(() => {
    const onRegionRequest = () => {
      if (isPlaying) {
        setCameraAuthoringError('Pause playback before capturing a camera region.');
        return;
      }
      if (boardView) {
        setCameraAuthoringError('Leave Board view before capturing a camera region.');
        return;
      }
      if (targetAnimationPathCapture || polylinePointCaptureId) {
        setCameraAuthoringError('Finish or cancel the active canvas capture first.');
        return;
      }
      setCameraAuthoringError(null);
      setFitPreview(null);
      setViewMode('follow');
      setRegionCapture({ context: authoringContext, start: null, current: null });
    };
    const onFitRequest = (event: Event) => {
      const detail = (event as CustomEvent<CameraFitRequestEventDetail>).detail;
      const objectIds = [...selectedIds].filter((id) => {
        const item = itemsMap.get(id);
        return item && ['axes', 'shape', 'image', 'textLine'].includes(item.kind);
      });
      if (objectIds.length !== 1) {
        setCameraAuthoringError('Select exactly one measured object to fit.');
        return;
      }
      const result = fitCameraObjectSnapshot(
        objectIds[0]!,
        itemsMap,
        frames,
        startFrameId,
        currentTime,
        cameraObjectFitPadding,
      );
      if (!result.ok) {
        setCameraAuthoringError(result.reason);
        return;
      }
      const cameraId = detail?.cameraId && itemsMap.get(detail.cameraId)?.kind === 'camera_move'
        ? detail.cameraId
        : null;
      if (detail?.cameraId && !cameraId) {
        setCameraAuthoringError('Camera clip to refit was not found.');
        return;
      }
      setCameraAuthoringError(null);
      setRegionCapture(null);
      setFitPreview({
        context: authoringContext,
        bounds: result.viewport,
        destination: result.destination,
        targetFrameId: result.targetFrameId!,
        cameraId,
      });
    };
    window.addEventListener(CAMERA_REGION_REQUEST_EVENT, onRegionRequest);
    window.addEventListener(CAMERA_FIT_REQUEST_EVENT, onFitRequest);
    return () => {
      window.removeEventListener(CAMERA_REGION_REQUEST_EVENT, onRegionRequest);
      window.removeEventListener(CAMERA_FIT_REQUEST_EVENT, onFitRequest);
    };
  }, [isPlaying, boardView, targetAnimationPathCapture, polylinePointCaptureId, authoringContext, selectedIds, itemsMap, frames, startFrameId, currentTime, cameraObjectFitPadding]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (!regionCapture && !fitPreview) return;
      cancelCameraAuthoring();
      setCameraAuthoringError('Camera capture cancelled.');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [regionCapture, fitPreview, cancelCameraAuthoring]);

  useEffect(() => {
    if (!regionCapture && !fitPreview) return;
    const viewChanged = Boolean(regionCapture && (boardView || isPlaying || viewMode !== 'follow'));
    const contextChanged = !cameraCaptureContextUnchanged((regionCapture ?? fitPreview)!.context, authoringContext);
    if (!viewChanged && !contextChanged) return;
    const timer = window.setTimeout(() => {
      cancelCameraAuthoring();
      setCameraAuthoringError(viewChanged
        ? 'Camera capture cancelled because the view or playback changed.'
        : 'Camera capture cancelled because scene, time, or frames changed.');
    }, 0);
    return () => window.clearTimeout(timer);
  }, [regionCapture, fitPreview, authoringContext, boardView, isPlaying, viewMode, cancelCameraAuthoring]);

  const visibleItems = useMemo(
    () =>
      Array.from(itemsMap.values())
        .filter(
          (it): it is TextLineItem =>
            it.kind === 'textLine' &&
            isActiveAtTime(it, currentTime, itemsMap) &&
            (!isTransformSourceHiddenInPreview(it, currentTime, itemsMap) ||
              selectedIds.has(it.id)),
        )
        .sort((a, b) => a.layer - b.layer),
    [itemsMap, currentTime, selectedIds],
  );

  const visibleShapes = useMemo(
    () =>
      Array.from(itemsMap.values())
        .filter(
          (it): it is ShapeItem =>
            it.kind === 'shape' && isActiveAtTime(it, currentTime, itemsMap),
        )
        .sort((a, b) => {
          if (a.layer !== b.layer) return a.layer - b.layer;
          // Same layer: draw selected shape last so its transformer handles sit on top.
          const sa = selectedIds.has(a.id) ? 1 : 0;
          const sb = selectedIds.has(b.id) ? 1 : 0;
          return sa - sb;
        }),
    [itemsMap, currentTime, selectedIds],
  );

  const visibleImages = useMemo(
    () =>
      Array.from(itemsMap.values())
        .filter(
          (it): it is ImageItem =>
            it.kind === 'image' && isActiveAtTime(it, currentTime, itemsMap),
        )
        .sort((a, b) => {
          if (a.layer !== b.layer) return a.layer - b.layer;
          // Same layer: draw selected image last so its transformer handles sit on top.
          const sa = selectedIds.has(a.id) ? 1 : 0;
          const sb = selectedIds.has(b.id) ? 1 : 0;
          return sa - sb;
        }),
    [itemsMap, currentTime, selectedIds],
  );

  const surroundCanvasEntries = useMemo((): CanvasEntry[] => {
    const out: CanvasEntry[] = [];
    for (const it of itemsMap.values()) {
      if (it.kind !== 'surroundingRect') continue;
      const bboxManimRaw = surroundPreviewBBoxManim(
        it,
        itemsMap,
        currentTime,
        selectedIds,
      );
      if (!bboxManimRaw) continue;
      const taSr = targetAnimPreviewAccum(it.id, currentTime, itemsMap);
      const firstTarget = it.targetIds[0] ? itemsMap.get(it.targetIds[0]) : null;
      const fc = firstTarget ? frameOffsetForItem(firstTarget) : { x: 0, y: 0 };
      const bboxManim = shiftBBoxManim(
        bboxManimRaw,
        taSr.dx + fc.x,
        taSr.dy + fc.y,
      );
      out.push({
        kind: 'surround',
        layer: it.layer,
        item: it,
        bboxManim,
      });
    }
    return out;
  }, [itemsMap, currentTime, selectedIds, frameOffsetForItem]);

  const graphLayers = useMemo((): GraphLayerState[] => {
    const axesItems = Array.from(itemsMap.values()).filter(
      (it): it is AxesItem => it.kind === 'axes',
    );
    return axesItems
      .filter(
        (ax) =>
          graphGroupShouldRender(ax, currentTime, itemsMap) ||
          selectedIds.has(ax.id) ||
          selectionTouchesAxes(ax.id, selectedIds, itemsMap),
      )
      .map((axes) => {
        const pos = resolvePosition(axes, itemsMap);
        const fc = frameOffsetForItem(axes);
        let streamPlacementFieldId: ItemId | null = null;
        for (const it of itemsMap.values()) {
          if (
            it.kind === 'graphField' &&
            it.axesId === axes.id &&
            (it.streamPlacementActive ?? false) &&
            selectedIds.has(it.id)
          ) {
            streamPlacementFieldId = it.id;
            break;
          }
        }
        const field = cumulativeField(axes.id, currentTime, itemsMap);
        const taAx = targetAnimPreviewAccum(axes.id, currentTime, itemsMap);
        return {
          axes,
          drawOrder: cumulativeAxesDrawOrder(
            axes.id,
            currentTime,
            itemsMap,
            field,
          ),
          field,
          streamPlacementFieldId,
          resolvedX: pos.x + taAx.dx + fc.x,
          resolvedY: pos.y + taAx.dy + fc.y,
          isSelected: selectionTouchesAxes(axes.id, selectedIds, itemsMap),
        };
      });
  }, [itemsMap, currentTime, selectedIds, frameOffsetForItem]);

  const canvasEntries = useMemo((): CanvasEntry[] => {
    const e: CanvasEntry[] = [];
    for (const g of graphLayers) {
      e.push({ kind: 'graph', layer: g.axes.layer, graph: g });
    }
    for (const item of visibleItems) {
      e.push({ kind: 'text', layer: item.layer, item });
    }
    for (const item of visibleShapes) {
      e.push({ kind: 'shape', layer: item.layer, item });
    }
    for (const item of visibleImages) {
      e.push({ kind: 'image', layer: item.layer, item });
    }
    e.push(...surroundCanvasEntries);
    e.sort((a, b) => a.layer - b.layer);
    return e;
  }, [graphLayers, visibleItems, visibleShapes, visibleImages, surroundCanvasEntries]);

  const resolvedPositions = useResolvedPositions(visibleItems, itemsMap, currentTime);
  const resolvedShapePositions = useResolvedPositions(
    visibleShapes,
    itemsMap,
    currentTime,
  );
  const resolvedImagePositions = useResolvedPositions(
    visibleImages,
    itemsMap,
    currentTime,
  );

  const snapBoxes = useMemo(() => {
    const boxes: SnapBox[] = [];
    for (const item of committedItems.values()) {
      if (!isActiveAtTime(item, currentTime, committedItems)) continue;
      if (item.kind !== 'textLine' && item.kind !== 'shape' && item.kind !== 'image' && item.kind !== 'axes') continue;
      const ta = targetAnimPreviewAccum(item.id, currentTime, committedItems);
      if (Math.abs(ta.dx) + Math.abs(ta.dy) > 1e-6 || Math.abs(ta.scaleMul - 1) > 1e-6 || Math.abs(ta.rotDeg) > 1e-6) continue;
      const p = resolvePosition(item, committedItems);
      const frame = frameOffsetForItem(item);
      const x = p.x + frame.x;
      const y = p.y + frame.y;
      if (item.kind === 'textLine') {
        const b = measuredInkBox(item.id, x, y, item.measure, item.scale);
        if (b) boxes.push(b);
      } else if (item.kind === 'axes') {
        const w = (item.xRange[1] - item.xRange[0]) * item.scaleX;
        const h = (item.yRange[1] - item.yRange[0]) * item.scaleY;
        boxes.push({ id: item.id, left: x - w / 2, right: x + w / 2, bottom: y - h / 2, top: y + h / 2 });
      } else if (item.kind === 'image') {
        const w = item.width * item.scale;
        const h = item.height * item.scale;
        const a = (item.rotationDeg * Math.PI) / 180;
        const hw = (Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))) / 2;
        const hh = (Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a))) / 2;
        boxes.push({ id: item.id, left: x - hw, right: x + hw, bottom: y - hh, top: y + hh });
      } else {
        const angle = (item.rotationDeg * Math.PI) / 180;
        const localPoints = item.shapeType === 'polyline'
          ? item.points.map((point) => ({ x: point.x * item.scale, y: point.y * item.scale }))
          : item.shapeType === 'line' || item.shapeType === 'arrow'
            ? [
                { x: -item.endX * item.scale / 2, y: item.endY * item.scale / 2 },
                { x: item.endX * item.scale / 2, y: -item.endY * item.scale / 2 },
              ]
            : (() => {
                const hw = (item.shapeType === 'circle' ? item.radius : item.width / 2) * item.scale;
                const hh = (item.shapeType === 'circle' ? item.radius : item.height / 2) * item.scale;
                return [{ x: -hw, y: -hh }, { x: -hw, y: hh }, { x: hw, y: -hh }, { x: hw, y: hh }];
              })();
        const rotated = localPoints.map((point) => ({
          x: x + point.x * Math.cos(angle) - point.y * Math.sin(angle),
          y: y + point.x * Math.sin(angle) + point.y * Math.cos(angle),
        }));
        if (rotated.length) {
          boxes.push({
            id: item.id,
            left: Math.min(...rotated.map((p) => p.x)),
            right: Math.max(...rotated.map((p) => p.x)),
            bottom: Math.min(...rotated.map((p) => p.y)),
            top: Math.max(...rotated.map((p) => p.y)),
          });
        }
      }
    }
    return boxes;
  }, [committedItems, currentTime, frameOffsetForItem]);

  const snapFrameScale = contentTransform.scale;

  const updateSize = useCallback(() => {
    if (!containerRef.current) return;
    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    if (w <= 0 || h <= 0) return;

    onFrameRectChange?.(containerRef.current.getBoundingClientRect());

    const scale = Math.min(w / FRAME_W, h / FRAME_H);
    setSize({ width: FRAME_W * scale, height: FRAME_H * scale });
  }, [onFrameRectChange]);

  useEffect(() => {
    updateSize();
    const obs = new ResizeObserver(updateSize);
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [updateSize]);

  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={showGrid}
            onChange={(e) => setShowGrid(e.target.checked)}
            className="accent-blue-500"
          />
          Grid
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={showAxes}
            onChange={(e) => setShowAxes(e.target.checked)}
            className="accent-blue-500"
          />
          Axes
        </label>
        <label className="flex items-center gap-1 cursor-pointer" title="Snap visible text edges to nearby objects and frame edges. Hold Alt while dragging to bypass. Snapping places text but does not attach it.">
          <input
            type="checkbox"
            checked={snapText}
            onChange={(e) => {
              setSnapText(e.target.checked);
              if (!e.target.checked) setSnapGuides(null);
            }}
            className="accent-blue-500"
          />
          Snap text
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={renderLikePreview}
            onChange={(e) => setRenderLikePreview(e.target.checked)}
            className="accent-blue-500"
          />
          Render-like
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={boardView}
            onChange={(e) => setBoardView(e.target.checked)}
            className="accent-blue-500"
          />
          Board
        </label>
        <div className="flex items-center gap-1">
          <span className="text-slate-500">View</span>
          <button
            type="button"
            onClick={() => {
              setViewMode('follow');
              setCameraAuthoringError(null);
            }}
            title="Follow the authored camera"
            className={`rounded border px-2 py-0.5 transition-colors ${
              viewMode === 'follow'
                ? 'border-blue-500 bg-blue-600/30 text-blue-200'
                : 'border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Follow camera
          </button>
          <select
            value=""
            onChange={(e) => {
              const f = frames.find((fr) => fr.id === e.target.value);
              if (!f) return;
              setFreeOffset(frameCenter(f));
              setFreeWidth(FRAME_W);
              setViewMode('free');
            }}
            title="Jump the preview to a frame (does not change export)"
            className="bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-slate-300"
          >
            <option value="">View frame…</option>
            {readingOrderFrames(frames).map((f) => (
              <option key={f.id} value={f.id}>
                {frameDisplayName(f, frames)}
              </option>
            ))}
          </select>
          {viewMode === 'free' && !isPlaying && (
            <span className="text-amber-300/80">Free view · drag/scroll to pan</span>
          )}
        </div>
        {fitPreview ? (
          <div className="flex items-center gap-2 rounded border border-amber-400/50 bg-amber-500/10 px-2 py-1 text-amber-200">
            <span>Object fit preview</span>
            <button type="button" onClick={applyFitPreview} className="rounded bg-emerald-600 px-2 py-0.5 text-white">Apply</button>
            <button type="button" onClick={cancelCameraAuthoring} className="rounded bg-slate-700 px-2 py-0.5">Cancel</button>
          </div>
        ) : null}
        {cameraAuthoringError ? (
          <span className="text-rose-300">{cameraAuthoringError}</span>
        ) : null}
        <label className="flex items-center gap-1 cursor-pointer">
          Divisions
          <input
            type="number"
            min={4}
            max={32}
            value={gridDivisions}
            onChange={(e) => setGridDivisions(Math.max(4, Math.min(32, +e.target.value || 16)))}
            className="w-12 bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-slate-300"
          />
        </label>
        <span className="ml-auto text-slate-500">
          {FRAME_W.toFixed(2)} x {FRAME_H} Manim units
        </span>
      </div>

      <div
        ref={containerRef}
        className="w-full h-full flex-1 min-h-0 rounded-lg overflow-hidden border border-slate-700 bg-black flex items-center justify-center"
        style={{ cursor: regionCapture ? 'crosshair' : !isPlaying && !boardView ? 'grab' : 'default' }}
      >
        <Stage
          width={size.width}
          height={size.height}
          onMouseDown={(e) => {
            const stage = e.target.getStage();
            const pos = stage?.getPointerPosition();
            if (regionCapture && stage && pos) {
              if (e.target !== stage) return;
              setRegionCapture((current) => current ? { ...current, start: pos, current: pos } : null);
              return;
            }
            if (isPlaying || boardView) return;
            if (targetAnimationPathCapture || polylinePointCaptureId) return;
            if (!stage || e.target !== stage || !pos) return;
            panRef.current = {
              active: true,
              startX: pos.x,
              startY: pos.y,
              startOffset: { x: effectiveCameraPose.x, y: effectiveCameraPose.y },
            };
            didPanRef.current = false;
          }}
          onMouseMove={(e) => {
            if (regionCapture?.start) {
              const pos = e.target.getStage()?.getPointerPosition();
              if (pos) setRegionCapture((current) => current ? { ...current, current: pos } : null);
              return;
            }
            const p = panRef.current;
            if (!p?.active) return;
            const pos = e.target.getStage()?.getPointerPosition();
            if (!pos) return;
            const dxPx = pos.x - p.startX;
            const dyPx = pos.y - p.startY;
            if (Math.abs(dxPx) + Math.abs(dyPx) > 2) didPanRef.current = true;
            setFreeWidth(effectiveCameraPose.width);
            setViewMode('free');
            setFreeOffset({
              x: p.startOffset.x - (dxPx * effectiveCameraPose.width) / size.width,
              y: p.startOffset.y + (dyPx * effectiveCameraPose.width * FRAME_H / FRAME_W) / size.height,
            });
          }}
          onMouseUp={() => {
            if (regionCapture?.start && regionCapture.current) {
              const capture = regionCapture;
              if (!cameraCaptureContextUnchanged(capture.context, authoringContext)) {
                setCameraAuthoringError('Camera region cancelled because scene, time, or frames changed.');
                setRegionCapture(null);
                return;
              }
              const captureStart = capture.start!;
              const captureEnd = capture.current!;
              const start = canvasToWorldPoint(captureStart, size.width, size.height, contentTransform);
              const end = canvasToWorldPoint(captureEnd, size.width, size.height, contentTransform);
              const fit = cameraRegionBoundsFromDrag(start, end);
              setRegionCapture(null);
              if (!fit.ok) {
                setCameraAuthoringError(fit.reason);
                return;
              }
              const schedule = resolveCameraSchedule(
                itemsMap,
                frames,
                startFrameId,
                deletedPreviewIds,
              );
              const targetFrameId = logicalCameraFrameAtTime(capture.context.time, schedule);
              const center = frameCenterById(frames, targetFrameId);
              const clip = createCameraMove(targetFrameId, capture.context.time, 1);
              clip.label = 'Zoom to region';
              clip.targetWidth = fit.destination.width;
              clip.offsetX = fit.destination.x - center.x;
              clip.offsetY = fit.destination.y - center.y;
              addCameraMoveClip(clip);
              setCameraAuthoringError(null);
              return;
            }
            if (panRef.current) panRef.current.active = false;
          }}
          onMouseLeave={() => {
            if (regionCapture?.start) {
              setRegionCapture(null);
              setCameraAuthoringError('Camera region cancelled after pointer loss.');
            }
            if (panRef.current) panRef.current.active = false;
          }}
          onWheel={(e) => {
            if (isPlaying || boardView) return;
            e.evt.preventDefault();
            setFreeWidth(effectiveCameraPose.width);
            setViewMode('free');
            setFreeOffset({
              x: effectiveCameraPose.x + (e.evt.deltaX * effectiveCameraPose.width) / size.width,
              y: effectiveCameraPose.y - (e.evt.deltaY * effectiveCameraPose.width * FRAME_H / FRAME_W) / size.height,
            });
          }}
          onClick={(e) => {
            if (regionCapture) return;
            const stage = e.target.getStage();
            if (targetAnimationPathCapture && stage) {
              const pos = stage.getPointerPosition();
              const clip = itemsMap.get(targetAnimationPathCapture.clipId);
              if (pos && clip?.kind === 'target_animation' && clip.mode === 'path') {
                const row = clip.targets[targetAnimationPathCapture.rowIndex];
                const target = row ? itemsMap.get(row.targetId) : undefined;
                if (row && target && (row.pathKind ?? 'polyline') === 'polyline') {
                  const abs = canvasToWorldPoint(pos, size.width, size.height, contentTransform);
                  const base = resolvePosition(target, itemsMap);
                  const ta = targetAnimPreviewAccum(
                    target.id,
                    clip.startTime,
                    itemsMap,
                  );
                  const anchor = { x: base.x + ta.dx, y: base.y + ta.dy };
                  const fc = frameOffsetForItem(target);
                  const existing =
                    row.pathPoints && row.pathPoints.length > 0
                      ? row.pathPoints
                      : [{ x: 0, y: 0 }];
                  const nextTargets = clip.targets.map((r, i) =>
                    i === targetAnimationPathCapture.rowIndex
                      ? {
                          ...r,
                          pathPoints: [
                            ...existing,
                            {
                              x: abs.x - (anchor.x + fc.x),
                              y: abs.y - (anchor.y + fc.y),
                            },
                          ],
                        }
                      : r,
                  );
                  updateItem(clip.id, { targets: nextTargets });
                  select(clip.id);
                  return;
                }
              }
            }
            if (polylinePointCaptureId && stage && e.target === stage) {
              const pos = stage.getPointerPosition();
              const raw = itemsMap.get(polylinePointCaptureId);
              if (
                pos &&
                raw?.kind === 'shape' &&
                raw.shapeType === 'polyline' &&
                Math.abs(raw.rotationDeg) < 1e-6 &&
                Math.abs(raw.scale - 1) < 1e-6
              ) {
                  const abs = canvasToWorldPoint(pos, size.width, size.height, contentTransform);
                const anchorBase = resolvePosition(raw, itemsMap);
                const tad = targetAnimPreviewAccum(raw.id, currentTime, itemsMap);
                const fc = frameOffsetForItem(raw);
                const anchor = {
                  x: anchorBase.x + tad.dx + fc.x,
                  y: anchorBase.y + tad.dy + fc.y,
                };
                updateItem(raw.id, {
                  points: [...raw.points, { x: abs.x - anchor.x, y: abs.y - anchor.y }],
                });
                select(raw.id);
                return;
              }
            }
            if (didPanRef.current) {
              didPanRef.current = false;
              return;
            }
            if (e.target === e.target.getStage()) clearSelection();
          }}
        >
          <Layer>
            <GridLayer
              canvasWidth={size.width}
              canvasHeight={size.height}
              divisions={gridDivisions}
              showGrid={showGrid && !renderLikePreview}
              showAxes={showAxes && !renderLikePreview}
            />
          </Layer>
          <Layer>
            <Group
              x={contentTransform.x}
              y={contentTransform.y}
              scaleX={contentTransform.scale}
              scaleY={contentTransform.scale}
              listening={!regionCapture}
            >
            {boardView &&
              frames.map((frame) => {
                const c = frameCenter(frame);
                const topLeft = manimToCanvas(
                  c.x - FRAME_W / 2,
                  c.y + FRAME_H / 2,
                  size.width,
                  size.height,
                );
                const frameSize = {
                  w: (FRAME_W / FRAME_W) * size.width,
                  h: (FRAME_H / FRAME_H) * size.height,
                };
                return (
                  <Group key={frame.id} listening={false}>
                    <Rect
                      x={topLeft.x}
                      y={topLeft.y}
                      width={frameSize.w}
                      height={frameSize.h}
                      stroke={frame.id === startFrameId ? '#fbbf24' : '#64748b'}
                      strokeWidth={frame.id === startFrameId ? 3 : 2}
                      dash={[10, 6]}
                    />
                    <Text
                      x={topLeft.x + 8}
                      y={topLeft.y + 8}
                      text={`${frameDisplayName(frame, frames)} (${frame.col}, ${frame.row})`}
                      fill="#cbd5e1"
                      fontSize={18}
                    />
                  </Group>
                );
              })}
            {fitPreview ? (() => {
              const topLeft = manimToCanvas(fitPreview.bounds.left, fitPreview.bounds.top, size.width, size.height);
              const bottomRight = manimToCanvas(fitPreview.bounds.right, fitPreview.bounds.bottom, size.width, size.height);
              return (
                <Rect
                  x={topLeft.x}
                  y={topLeft.y}
                  width={bottomRight.x - topLeft.x}
                  height={bottomRight.y - topLeft.y}
                  stroke="#fbbf24"
                  strokeWidth={3}
                  dash={[10, 6]}
                  listening={false}
                />
              );
            })() : null}
            {regionCapture?.start && regionCapture.current ? (() => {
              const startWorld = canvasToWorldPoint(regionCapture.start, size.width, size.height, contentTransform);
              const endWorld = canvasToWorldPoint(regionCapture.current, size.width, size.height, contentTransform);
              const draftFit = cameraRegionBoundsFromDrag(startWorld, endWorld);
              const draftBounds = draftFit.ok
                ? draftFit.viewport
                : {
                    left: Math.min(startWorld.x, endWorld.x),
                    right: Math.max(startWorld.x, endWorld.x),
                    bottom: Math.min(startWorld.y, endWorld.y),
                    top: Math.max(startWorld.y, endWorld.y),
                  };
              const start = manimToCanvas(draftBounds.left, draftBounds.top, size.width, size.height);
              const end = manimToCanvas(draftBounds.right, draftBounds.bottom, size.width, size.height);
              return (
                <Rect
                  x={Math.min(start.x, end.x)}
                  y={Math.min(start.y, end.y)}
                  width={Math.abs(end.x - start.x)}
                  height={Math.abs(end.y - start.y)}
                  fill="#38bdf822"
                  stroke="#38bdf6"
                  strokeWidth={2}
                  dash={[8, 5]}
                  listening={false}
                />
              );
            })() : null}
            {canvasEntries.map((entry) => {
              if (entry.kind === 'graph') {
                const layer = entry.graph;
                const taAxes = targetAnimPreviewAccum(
                  layer.axes.id,
                  currentTime,
                  itemsMap,
                );
                return (
                  <PreviewWrap key={layer.axes.id} op={previewOps.get(layer.axes.id)}>
                    <PlaybackWrap
                      exit={exitPreviewForTarget(layer.axes.id, currentTime, itemsMap)}
                      blink={blinkPreviewForTarget(layer.axes.id, currentTime, itemsMap)}
                      extraTaScale={taAxes.scaleMul}
                      rotationDeg={-taAxes.rotDeg}
                      scaleAnchor={manimToCanvas(
                        layer.resolvedX,
                        layer.resolvedY,
                        size.width,
                        size.height,
                      )}
                    >
                      <GraphNode
                        axes={layer.axes}
                        drawOrder={layer.drawOrder}
                        field={layer.field}
                        streamPlacementFieldId={layer.streamPlacementFieldId}
                        isSelected={layer.isSelected}
                        renderLikePreview={renderLikePreview}
                        canvasWidth={size.width}
                        canvasHeight={size.height}
                        resolvedX={layer.resolvedX}
                        resolvedY={layer.resolvedY}
                        frameOffset={frameOffsetForItem(layer.axes)}
                        currentTime={currentTime}
                        itemsMap={itemsMap}
                      />
                    </PlaybackWrap>
                  </PreviewWrap>
                );
              }
              if (entry.kind === 'text') {
                const item = entry.item;
                const selected = selectedIds.has(item.id);
                const pos = resolvedPositions.get(item.id);
                const transformPreview = activeTextTransformForLine(
                  item,
                  currentTime,
                  itemsMap,
                  audioItems,
                );
                const transformPreviewWithPositions = transformPreview
                  ? {
                      ...transformPreview,
                      sourceResolvedX:
                        (resolvedPositions.get(transformPreview.source.id) ??
                          resolvePosition(transformPreview.source, itemsMap)).x,
                      sourceResolvedY:
                        (resolvedPositions.get(transformPreview.source.id) ??
                          resolvePosition(transformPreview.source, itemsMap)).y,
                      targetResolvedX:
                        (resolvedPositions.get(transformPreview.target.id) ??
                          resolvePosition(transformPreview.target, itemsMap)).x,
                      targetResolvedY:
                        (resolvedPositions.get(transformPreview.target.id) ??
                          resolvePosition(transformPreview.target, itemsMap)).y,
                    }
                  : null;
                const blinkText = blinkPreviewForTarget(item.id, currentTime, itemsMap);
                const taTxt = targetAnimPreviewAccum(item.id, currentTime, itemsMap);
                const fcTxt = frameOffsetForItem(item);
                const playbackBlink =
                  blinkText && !blinkText.applyOuterBlinkScale
                    ? { ...blinkText, scaleMultiplier: 1 }
                    : blinkText;
                const itemFrameId = 'frameId' in item && item.frameId ? item.frameId : startFrameId;
                const snapTargets = snapBoxes.filter((box) => {
                  if (box.id === item.id) return false;
                  const target = committedItems.get(box.id);
                  const targetFrameId = target && 'frameId' in target && target.frameId ? target.frameId : startFrameId;
                  return targetFrameId === itemFrameId;
                });
                const textSnapContext = {
                  enabled: snapText && !isPlaying && !transformPreview && !blinkText && !exitPreviewForTarget(item.id, currentTime, itemsMap) &&
                    Math.abs(taTxt.dx) < 1e-6 && Math.abs(taTxt.dy) < 1e-6 &&
                    Math.abs(taTxt.scaleMul - 1) < 1e-6 && Math.abs(taTxt.rotDeg) < 1e-6,
                  frameOffset: fcTxt,
                  frameCenter: frameCenterById(frames, itemFrameId),
                  ink: item.measure && item.measure.widthInk > 0
                    ? { left: item.scale * item.measure.inkLeftX, right: item.scale * item.measure.inkRightX, bottom: item.scale * item.measure.inkBottomY, top: item.scale * item.measure.inkTopY }
                    : null,
                  targets: snapTargets,
                  pxPerUnitX: effectiveSnapPixelsPerUnit(size.width / FRAME_W, snapFrameScale),
                  pxPerUnitY: effectiveSnapPixelsPerUnit(size.height / FRAME_H, snapFrameScale),
                  buffer: Number.isFinite(item.snapBuffer) ? Math.max(0, item.snapBuffer!) : 0.3,
                  canvasWidth: size.width,
                  canvasHeight: size.height,
                  onGuides: (guides: TextSnapGuide[]) => setSnapGuides(guides.length ? { itemId: item.id, guides } : null),
                  isTargetValid: (id: string) => committedItems.has(id),
                };
                const mx = (pos?.x ?? item.x) + fcTxt.x;
                const my = (pos?.y ?? item.y) + fcTxt.y;
                const localToWorld = (target: SceneItem, p: { x: number; y: number }) => {
                  const fc = frameOffsetForItem(target);
                  return { x: p.x + fc.x, y: p.y + fc.y };
                };
                const transformWorld = transformPreviewWithPositions
                  ? {
                      ...transformPreviewWithPositions,
                      sourceResolvedX: localToWorld(transformPreviewWithPositions.source, {
                        x: transformPreviewWithPositions.sourceResolvedX,
                        y: transformPreviewWithPositions.sourceResolvedY,
                      }).x,
                      sourceResolvedY: localToWorld(transformPreviewWithPositions.source, {
                        x: transformPreviewWithPositions.sourceResolvedX,
                        y: transformPreviewWithPositions.sourceResolvedY,
                      }).y,
                      targetResolvedX: localToWorld(transformPreviewWithPositions.target, {
                        x: transformPreviewWithPositions.targetResolvedX,
                        y: transformPreviewWithPositions.targetResolvedY,
                      }).x,
                      targetResolvedY: localToWorld(transformPreviewWithPositions.target, {
                        x: transformPreviewWithPositions.targetResolvedX,
                        y: transformPreviewWithPositions.targetResolvedY,
                      }).y,
                    }
                  : null;
                return (
                  <PreviewWrap key={item.id} op={previewOps.get(item.id)}>
                    <PlaybackWrap
                      exit={exitPreviewForTarget(item.id, currentTime, itemsMap)}
                      blink={playbackBlink}
                      extraTaScale={taTxt.scaleMul}
                      rotationDeg={-taTxt.rotDeg}
                      scaleAnchor={manimToCanvas(mx, my, size.width, size.height)}
                    >
                      <TextLineNode
                        item={item}
                        canvasWidth={size.width}
                        canvasHeight={size.height}
                        isSelected={selected}
                        resolvedX={mx}
                        resolvedY={my}
                        frameOffset={fcTxt}
                        currentTime={currentTime}
                        itemsMap={itemsMap}
                        audioItems={audioItems}
                        transformPreview={transformWorld}
                        blinkPreview={blinkText}
                        textSnap={textSnapContext}
                      />
                    </PlaybackWrap>
                  </PreviewWrap>
                );
              }
              if (entry.kind === 'shape') {
                const item = entry.item;
                const selected = selectedIds.has(item.id);
                const pos = resolvedShapePositions.get(item.id);
                const bShape = blinkPreviewForTarget(item.id, currentTime, itemsMap);
                const taShape = targetAnimPreviewAccum(item.id, currentTime, itemsMap);
                const fcShape = frameOffsetForItem(item);
                const strokeBase = item.strokeColor || '#60a5fa';
                const previewStroke = strokeAfterBlinkThenTa(
                  strokeBase,
                  bShape,
                  taShape,
                );
                const previewFill =
                  item.fillColor != null &&
                  item.fillColor !== ''
                    ? strokeAfterBlinkThenTa(item.fillColor, bShape, taShape)
                    : undefined;
                const mx = (pos?.x ?? item.x) + fcShape.x;
                const my = (pos?.y ?? item.y) + fcShape.y;
                return (
                  <PreviewWrap key={item.id} op={previewOps.get(item.id)}>
                    <PlaybackWrap
                      exit={exitPreviewForTarget(item.id, currentTime, itemsMap)}
                      blink={bShape}
                      extraTaScale={taShape.scaleMul}
                      scaleAnchor={manimToCanvas(mx, my, size.width, size.height)}
                    >
                      <ShapeNode
                        item={item}
                        canvasWidth={size.width}
                        canvasHeight={size.height}
                        isSelected={selected}
                        resolvedX={mx}
                        resolvedY={my}
                        frameOffset={fcShape}
                        previewStrokeColor={previewStroke}
                        previewFillColor={previewFill}
                        previewRotationDeltaDeg={-taShape.rotDeg}
                      />
                    </PlaybackWrap>
                  </PreviewWrap>
                );
              }
              if (entry.kind === 'image') {
                const item = entry.item;
                const selected = selectedIds.has(item.id);
                const pos = resolvedImagePositions.get(item.id);
                const bImg = blinkPreviewForTarget(item.id, currentTime, itemsMap);
                const taImg = targetAnimPreviewAccum(item.id, currentTime, itemsMap);
                const fcImg = frameOffsetForItem(item);
                const mx = (pos?.x ?? item.x) + fcImg.x;
                const my = (pos?.y ?? item.y) + fcImg.y;
                // Manim-smooth FadeIn over the image clip duration (export
                // `FadeIn(image_N, run_time=item.duration)`); multiplies with
                // exit fade inside PlaybackWrap, agent-preview dimming outside.
                const introImg = imageIntroOpacity(item, currentTime, itemsMap, audioItems);
                return (
                  <PreviewWrap key={item.id} op={previewOps.get(item.id)}>
                    <PlaybackWrap
                      exit={exitPreviewForTarget(item.id, currentTime, itemsMap)}
                      blink={bImg}
                      extraTaScale={taImg.scaleMul}
                      rotationDeg={-taImg.rotDeg}
                      scaleAnchor={manimToCanvas(mx, my, size.width, size.height)}
                      baseOpacity={introImg}
                    >
                      <ImageNode
                        item={item}
                        canvasWidth={size.width}
                        canvasHeight={size.height}
                        isSelected={selected}
                        resolvedX={mx}
                        resolvedY={my}
                        frameOffset={fcImg}
                      />
                    </PlaybackWrap>
                  </PreviewWrap>
                );
              }
              const sr = entry.item;
              const bSr = blinkPreviewForTarget(sr.id, currentTime, itemsMap);
              const srTa = targetAnimPreviewAccum(sr.id, currentTime, itemsMap);
              const srStroke = strokeAfterBlinkThenTa(sr.color, bSr, srTa);
              return (
                <PreviewWrap key={sr.id} op={previewOps.get(sr.id)}>
                  <PlaybackWrap
                    exit={exitPreviewForTarget(sr.id, currentTime, itemsMap)}
                    blink={bSr}
                    extraTaScale={srTa.scaleMul}
                    rotationDeg={-srTa.rotDeg}
                    scaleAnchor={surroundBBoxCanvasCenter(
                      entry.bboxManim,
                      size.width,
                      size.height,
                    )}
                  >
                    <SurroundingRectNode
                      item={sr}
                      bboxManim={entry.bboxManim}
                      canvasWidth={size.width}
                      canvasHeight={size.height}
                      isSelected={selectedIds.has(sr.id)}
                      previewStrokeColor={srStroke}
                    />
                  </PlaybackWrap>
                </PreviewWrap>
              );
            })}
            {snapGuides?.guides.map((guide, index) => {
              const a = guide.axis === 'x'
                ? manimToCanvas(guide.value, guide.from, size.width, size.height)
                : manimToCanvas(guide.from, guide.value, size.width, size.height);
              const b = guide.axis === 'x'
                ? manimToCanvas(guide.value, guide.to, size.width, size.height)
                : manimToCanvas(guide.to, guide.value, size.width, size.height);
              return (
                <Group key={`${guide.targetId}-${guide.axis}-${index}`} listening={false}>
                  <KonvaLine points={[a.x, a.y, b.x, b.y]} stroke="#38bdf8" strokeWidth={1.5} dash={[5, 4]} />
                  <Text x={a.x + 4} y={a.y + 3} text={`${guide.label}`} fill="#7dd3fc" fontSize={12} />
                </Group>
              );
            })}
            </Group>
          </Layer>
        </Stage>
      </div>
    </div>
  );
}

function PlaybackWrap({
  exit,
  blink,
  scaleAnchor,
  extraTaScale = 1,
  rotationDeg = 0,
  baseOpacity = 1,
  children,
}: {
  exit: ExitPreviewState | null;
  blink: BlinkPreviewState | null;
  /** Canvas-space pivot for scale/rotation transforms. */
  scaleAnchor: { x: number; y: number };
  /** Multiplicative scale from cumulative target_animation preview (modes: scale); default 1. */
  extraTaScale?: number;
  /** Clockwise Konva rotation in degrees around `scaleAnchor` (typically `-ta.rotDeg`). */
  rotationDeg?: number;
  /**
   * Intro opacity multiplier (e.g. image FadeIn preview). Multiplied with the
   * exit fade so intro and exit compose; default 1 (no intro).
   */
  baseOpacity?: number;
  children: React.ReactNode;
}) {
  const base =
    typeof baseOpacity === 'number' && Number.isFinite(baseOpacity)
      ? Math.max(0, Math.min(1, baseOpacity))
      : 1;
  const opacity = Math.max(0, Math.min(1, (exit?.opacity ?? 1) * base));
  const taSc =
    typeof extraTaScale === 'number' &&
    Number.isFinite(extraTaScale) &&
    extraTaScale > 1e-9
      ? extraTaScale
      : 1;
  const rawScale =
    (exit?.scale ?? 1) * (blink?.scaleMultiplier ?? 1) * taSc;
  const scale =
    Number.isFinite(rawScale) && rawScale > 1e-9 ? rawScale : 1;
  const rot = Number.isFinite(rotationDeg) ? rotationDeg : 0;

  const needsScale = Math.abs(scale - 1) >= 1e-6;
  const needsOpacity = Math.abs(opacity - 1) >= 1e-6;
  const needsRotate = Math.abs(rot) >= 1e-6;

  if (!needsScale && !needsOpacity && !needsRotate) return <>{children}</>;

  const { x: ax, y: ay } = scaleAnchor;

  if (needsScale || needsRotate) {
    return (
      <Group
        opacity={opacity}
        x={ax}
        y={ay}
        rotation={rot}
        scaleX={scale}
        scaleY={scale}
      >
        <Group x={-ax} y={-ay}>
          {children}
        </Group>
      </Group>
    );
  }

  return <Group opacity={opacity}>{children}</Group>;
}

function PreviewWrap({
  op,
  children,
}: {
  op: PreviewOp | undefined;
  children: React.ReactNode;
}) {
  if (!op) return <>{children}</>;
  const opacity = op === 'delete' ? 0.3 : 0.55;
  return (
    <Group opacity={opacity} listening={op !== 'delete'}>
      {children}
    </Group>
  );
}
