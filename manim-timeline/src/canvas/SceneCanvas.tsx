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
        it.kind === 'graphDot' ||
        it.kind === 'graphField' ||
        it.kind === 'graphFunctionSeries' ||
        it.kind === 'graphArea') &&
      it.axesId === axesId
    ) {
      return true;
    }
  }
  return false;
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
      const bboxManim = surroundPreviewBBoxManim(
        it,
        itemsMap,
        currentTime,
        selectedIds,
      );
      if (!bboxManim) continue;
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
          resolvedX: pos.x,
          resolvedY: pos.y,
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

  const resolvedPositions = useResolvedPositions(visibleItems, itemsMap);
  const resolvedShapePositions = useResolvedPositions(visibleShapes, itemsMap);

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
                const anchor = resolvePosition(raw, itemsMap);
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
                return (
                  <PreviewWrap key={layer.axes.id} op={previewOps.get(layer.axes.id)}>
                    <PlaybackWrap
                      exit={exitPreviewForTarget(layer.axes.id, currentTime, itemsMap)}
                      blink={blinkPreviewForTarget(layer.axes.id, currentTime, itemsMap)}
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
                const mx = pos?.x ?? item.x;
                const my = pos?.y ?? item.y;
                return (
                  <PreviewWrap key={item.id} op={previewOps.get(item.id)}>
                    <PlaybackWrap
                      exit={exitPreviewForTarget(item.id, currentTime, itemsMap)}
                      blink={blinkText}
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
                const cMix =
                  bShape &&
                  (bShape.row.mode === 'color' || bShape.row.mode === 'scale_color')
                    ? bShape.colorMix
                    : 0;
                const previewStroke =
                  cMix > 0
                    ? lerpHexColor(
                        item.strokeColor || '#60a5fa',
                        bShape!.blinkColor,
                        cMix,
                      )
                    : undefined;
                const previewFill =
                  item.fillColor && cMix > 0
                    ? lerpHexColor(item.fillColor, bShape!.blinkColor, cMix)
                    : undefined;
                const mx = pos?.x ?? item.x;
                const my = pos?.y ?? item.y;
                return (
                  <PreviewWrap key={item.id} op={previewOps.get(item.id)}>
                    <PlaybackWrap
                      exit={exitPreviewForTarget(item.id, currentTime, itemsMap)}
                      blink={bShape}
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
                      />
                    </PlaybackWrap>
                  </PreviewWrap>
                );
              }
              const sr = entry.item;
              const bSr = blinkPreviewForTarget(sr.id, currentTime, itemsMap);
              const cmSr =
                bSr && (bSr.row.mode === 'color' || bSr.row.mode === 'scale_color')
                  ? bSr.colorMix
                  : 0;
              const srStroke =
                cmSr > 0 ? lerpHexColor(sr.color, bSr!.blinkColor, cmSr) : undefined;
              return (
                <PreviewWrap key={sr.id} op={previewOps.get(sr.id)}>
                  <PlaybackWrap
                    exit={exitPreviewForTarget(sr.id, currentTime, itemsMap)}
                    blink={bSr}
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
  children,
}: {
  exit: ExitPreviewState | null;
  blink: BlinkPreviewState | null;
  /** Canvas-space pivot for scale (exit × blink). Omit only if scale is always 1. */
  scaleAnchor: { x: number; y: number };
  children: React.ReactNode;
}) {
  const opacity = exit?.opacity ?? 1;
  const scale = (exit?.scale ?? 1) * (blink?.scaleMultiplier ?? 1);
  const needsScale = Math.abs(scale - 1) >= 1e-6;
  const needsOpacity = Math.abs(opacity - 1) >= 1e-6;

  if (!needsScale && !needsOpacity) return <>{children}</>;

  if (needsScale) {
    const { x: ax, y: ay } = scaleAnchor;
    return (
      <Group opacity={opacity} x={ax} y={ay} scaleX={scale} scaleY={scale}>
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
