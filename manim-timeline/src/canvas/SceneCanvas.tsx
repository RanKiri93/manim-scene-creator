import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Stage, Layer } from 'react-konva';
import { useSceneStore } from '@/store/useSceneStore';
import GridLayer from './layers/GridLayer';
import TextLineNode from './layers/TextLineNode';
import GraphNode from './layers/GraphNode';
import { useResolvedPositions } from './hooks/useResolvedPosition';
import { FRAME_W, FRAME_H } from '@/lib/constants';

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
        .filter((it) => currentTime >= it.startTime && currentTime < it.startTime + it.duration)
        .sort((a, b) => a.layer - b.layer),
    [itemsMap, currentTime],
  );

  const resolvedPositions = useResolvedPositions(visibleItems, itemsMap);

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
      {/* Canvas toolbar */}
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

      {/* Konva stage */}
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
            {visibleItems.map((item) => {
              const selected = selectedIds.has(item.id);
              const pos = resolvedPositions.get(item.id);
              if (item.kind === 'textLine') {
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
              if (item.kind === 'graph') {
                return (
                  <GraphNode
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
              return null;
            })}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
