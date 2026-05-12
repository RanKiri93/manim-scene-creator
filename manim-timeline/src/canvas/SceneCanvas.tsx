import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Stage, Layer, Group } from 'react-konva';
import { useSceneStore } from '@/store/useSceneStore';
import {
  usePreviewMergedItems,
  usePreviewOps,
  type PreviewOp,
} from '@/agent/previewSelectors';
import GridLayer from './layers/GridLayer';
import TextLineNode from './layers/TextLineNode';
import ShapeNode from './layers/ShapeNode';
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
import { manimToCanvas, surroundBBoxCanvasCenter } from '@/lib/canvasManimCoords';
import type {
  AxesItem,
  ItemId,
  SceneItem,
  ShapeItem,
  SurroundingRectItem,
  TextLineItem,
} from '@/types/scene';

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
  const [gridDivisions, setGridDivisions] = useState(16);

  const currentTime = useSceneStore((s) => s.currentTime);
  const audioItems = useSceneStore((s) => s.audioItems);
  const itemsMap = usePreviewMergedItems();
  const previewOps = usePreviewOps();
  const selectedIds = useSceneStore((s) => s.selectedIds);
  const clearSelection = useSceneStore((s) => s.clearSelection);
  const polylinePointCaptureId = useSceneStore((s) => s.polylinePointCaptureId);
  const targetAnimationPathCapture = useSceneStore(
    (s) => s.targetAnimationPathCapture,
  );
  const updateItem = useSceneStore((s) => s.updateItem);
  const select = useSceneStore((s) => s.select);

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
      const bboxManim = shiftBBoxManim(bboxManimRaw, taSr.dx, taSr.dy);
      out.push({
        kind: 'surround',
        layer: it.layer,
        item: it,
        bboxManim,
      });
    }
    return out;
  }, [itemsMap, currentTime, selectedIds]);

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
          resolvedX: pos.x + taAx.dx,
          resolvedY: pos.y + taAx.dy,
          isSelected: selectionTouchesAxes(axes.id, selectedIds, itemsMap),
        };
      });
  }, [itemsMap, currentTime, selectedIds]);

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
    e.push(...surroundCanvasEntries);
    e.sort((a, b) => a.layer - b.layer);
    return e;
  }, [graphLayers, visibleItems, visibleShapes, surroundCanvasEntries]);

  const resolvedPositions = useResolvedPositions(visibleItems, itemsMap, currentTime);
  const resolvedShapePositions = useResolvedPositions(
    visibleShapes,
    itemsMap,
    currentTime,
  );

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
      <div className="flex items-center gap-3 text-xs text-slate-400">
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
      >
        <Stage
          width={size.width}
          height={size.height}
          onClick={(e) => {
            const stage = e.target.getStage();
            if (targetAnimationPathCapture && stage) {
              const pos = stage.getPointerPosition();
              const clip = itemsMap.get(targetAnimationPathCapture.clipId);
              if (pos && clip?.kind === 'target_animation' && clip.mode === 'path') {
                const row = clip.targets[targetAnimationPathCapture.rowIndex];
                const target = row ? itemsMap.get(row.targetId) : undefined;
                if (row && target && (row.pathKind ?? 'polyline') === 'polyline') {
                  const abs = {
                    x: (pos.x / size.width - 0.5) * FRAME_W,
                    y: (0.5 - pos.y / size.height) * FRAME_H,
                  };
                  const base = resolvePosition(target, itemsMap);
                  const ta = targetAnimPreviewAccum(
                    target.id,
                    clip.startTime,
                    itemsMap,
                  );
                  const anchor = { x: base.x + ta.dx, y: base.y + ta.dy };
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
                            { x: abs.x - anchor.x, y: abs.y - anchor.y },
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
                const abs = {
                  x: (pos.x / size.width - 0.5) * FRAME_W,
                  y: (0.5 - pos.y / size.height) * FRAME_H,
                };
                const anchorBase = resolvePosition(raw, itemsMap);
                const tad = targetAnimPreviewAccum(raw.id, currentTime, itemsMap);
                const anchor = {
                  x: anchorBase.x + tad.dx,
                  y: anchorBase.y + tad.dy,
                };
                updateItem(raw.id, {
                  points: [...raw.points, { x: abs.x - anchor.x, y: abs.y - anchor.y }],
                });
                select(raw.id);
                return;
              }
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
                const playbackBlink =
                  blinkText && !blinkText.applyOuterBlinkScale
                    ? { ...blinkText, scaleMultiplier: 1 }
                    : blinkText;
                const mx = pos?.x ?? item.x;
                const my = pos?.y ?? item.y;
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
                        resolvedX={pos?.x ?? item.x}
                        resolvedY={pos?.y ?? item.y}
                        currentTime={currentTime}
                        itemsMap={itemsMap}
                        audioItems={audioItems}
                        transformPreview={transformPreviewWithPositions}
                        blinkPreview={blinkText}
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
                const mx = pos?.x ?? item.x;
                const my = pos?.y ?? item.y;
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
                        resolvedX={pos?.x ?? item.x}
                        resolvedY={pos?.y ?? item.y}
                        previewStrokeColor={previewStroke}
                        previewFillColor={previewFill}
                        previewRotationDeltaDeg={-taShape.rotDeg}
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
  children: React.ReactNode;
}) {
  const opacity = exit?.opacity ?? 1;
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
