import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Stage, Layer } from 'react-konva';
import { useSceneStore } from '@/store/useSceneStore';
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
  graphGroupShouldRender,
  cumulativeAxesDrawOrder,
  cumulativeField,
  type GraphAxesDrawSlot,
} from '@/lib/graphPreview';
import { resolvePosition } from '@/lib/resolvePosition';
import { surroundPreviewBBoxManim } from '@/lib/surroundCanvasPreview';
import type {
  AxesItem,
  ItemId,
  SceneItem,
  ShapeItem,
  SurroundingRectItem,
  TextLineItem,
} from '@/types/scene';

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

export default function SceneCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 450 });
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(true);
  const [gridDivisions, setGridDivisions] = useState(16);

  const currentTime = useSceneStore((s) => s.currentTime);
  const itemsMap = useSceneStore((s) => s.items);
  const selectedIds = useSceneStore((s) => s.selectedIds);
  const clearSelection = useSceneStore((s) => s.clearSelection);

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
    const scale = Math.min(w / FRAME_W, h / FRAME_H);
    setSize({ width: FRAME_W * scale, height: FRAME_H * scale });
  }, []);

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
            if (e.target === e.target.getStage()) clearSelection();
          }}
        >
          <Layer>
            <GridLayer
              canvasWidth={size.width}
              canvasHeight={size.height}
              divisions={gridDivisions}
              showGrid={showGrid}
              showAxes={showAxes}
            />
          </Layer>
          <Layer>
            {canvasEntries.map((entry) => {
              if (entry.kind === 'graph') {
                const layer = entry.graph;
                return (
                  <GraphNode
                    key={layer.axes.id}
                    axes={layer.axes}
                    drawOrder={layer.drawOrder}
                    field={layer.field}
                    streamPlacementFieldId={layer.streamPlacementFieldId}
                    isSelected={layer.isSelected}
                    canvasWidth={size.width}
                    canvasHeight={size.height}
                    resolvedX={layer.resolvedX}
                    resolvedY={layer.resolvedY}
                  />
                );
              }
              if (entry.kind === 'text') {
                const item = entry.item;
                const selected = selectedIds.has(item.id);
                const pos = resolvedPositions.get(item.id);
                return (
                  <TextLineNode
                    key={item.id}
                    item={item}
                    canvasWidth={size.width}
                    canvasHeight={size.height}
                    isSelected={selected}
                    resolvedX={pos?.x ?? item.x}
                    resolvedY={pos?.y ?? item.y}
                  />
                );
              }
              if (entry.kind === 'shape') {
                const item = entry.item;
                const selected = selectedIds.has(item.id);
                const pos = resolvedShapePositions.get(item.id);
                return (
                  <ShapeNode
                    key={item.id}
                    item={item}
                    canvasWidth={size.width}
                    canvasHeight={size.height}
                    isSelected={selected}
                    resolvedX={pos?.x ?? item.x}
                    resolvedY={pos?.y ?? item.y}
                  />
                );
              }
              const sr = entry.item;
              return (
                <SurroundingRectNode
                  key={sr.id}
                  item={sr}
                  bboxManim={entry.bboxManim}
                  canvasWidth={size.width}
                  canvasHeight={size.height}
                  isSelected={selectedIds.has(sr.id)}
                />
              );
            })}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
