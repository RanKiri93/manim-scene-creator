import { useRef, useCallback, type ReactNode } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { SceneItem, TextLineItem } from '@/types/scene';
import {
  isTopLevelItem,
  runDuration,
  segmentWaitTotal,
  textLineAnimOnlyDuration,
} from '@/lib/time';
import { itemClipDisplayName } from '@/lib/itemDisplayName';
import { collectAudioBoundaryTimes, snapToNearestBoundary } from './timelineSnap';

interface TimelineClipProps {
  item: SceneItem;
  /** Order within the layer (later clips stack above earlier for easier overlap clicks). */
  stackIndex: number;
  pxPerSecond: number;
  viewStart: number;
  isSelected: boolean;
}

const KIND_COLORS: Record<string, string> = {
  textLine: 'bg-blue-600/80 border-blue-400',
  axes: 'bg-emerald-600/80 border-emerald-400',
  graphPlot: 'bg-teal-600/80 border-teal-400',
  graphDot: 'bg-cyan-600/80 border-cyan-400',
  graphField: 'bg-lime-700/80 border-lime-400',
  graphSeriesViz: 'bg-amber-700/80 border-amber-400',
  compound: 'bg-violet-600/80 border-violet-400',
  exit_animation: 'bg-rose-700/85 border-rose-400',
  surroundingRect: 'bg-orange-700/85 border-orange-300',
  shape: 'bg-pink-700/85 border-pink-300',
};

function clipHasTimelineDuration(item: SceneItem): boolean {
  return item.kind !== 'compound';
}

export default function TimelineClip({
  item,
  stackIndex,
  pxPerSecond,
  viewStart,
  isSelected,
}: TimelineClipProps) {
  const select = useSceneStore((s) => s.select);
  const moveItem = useSceneStore((s) => s.moveItem);
  const setSceneItemStartTimes = useSceneStore((s) => s.setSceneItemStartTimes);
  const resizeItem = useSceneStore((s) => s.resizeItem);
  const audioItems = useSceneStore((s) => s.audioItems);
  const itemsMap = useSceneStore((s) => s.items);

  const dragRef = useRef<{
    startX: number;
    primaryBaseline: number;
    baselines: Record<string, number>;
  } | null>(null);
  const lastSnappedStartRef = useRef<number | null>(null);
  const resizeRef = useRef<{ startX: number; startDuration: number } | null>(null);

  const left = (item.startTime - viewStart) * pxPerSecond;
  const barDuration = clipHasTimelineDuration(item)
    ? runDuration(item, itemsMap)
    : 0;
  const width = Math.max(barDuration * pxPerSecond, 16);

  const label = (() => {
    const s = itemClipDisplayName(item);
    if (item.kind === 'exit_animation') {
      return s.length > 22 ? `${s.slice(0, 22)}…` : s;
    }
    return s.length > 28 ? `${s.slice(0, 28)}…` : s;
  })();

  const colors = KIND_COLORS[item.kind] ?? 'bg-slate-600/80 border-slate-400';

  const onMouseDownMove = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      select(item.id, e.shiftKey);
      const state = useSceneStore.getState();
      const baselines: Record<string, number> = {};
      for (const id of state.selectedIds) {
        const it = state.items.get(id);
        if (it && isTopLevelItem(it)) baselines[id] = it.startTime;
      }
      baselines[item.id] = state.items.get(item.id)?.startTime ?? item.startTime;
      dragRef.current = {
        startX: e.clientX,
        primaryBaseline: baselines[item.id]!,
        baselines,
      };
      lastSnappedStartRef.current = baselines[item.id]!;
      const boundaryTimes = collectAudioBoundaryTimes(audioItems);

      const applyDelta = (primarySnapped: number) => {
        const d = dragRef.current;
        if (!d) return;
        const delta = primarySnapped - d.primaryBaseline;
        const ids = Object.keys(d.baselines);
        if (ids.length <= 1) {
          moveItem(item.id, primarySnapped);
          return;
        }
        setSceneItemStartTimes(
          ids.map((id) => ({
            id,
            startTime: Math.max(0, d.baselines[id]! + delta),
          })),
        );
      };

      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const dx = ev.clientX - dragRef.current.startX;
        const dt = dx / pxPerSecond;
        const dragged = Math.max(0, dragRef.current.primaryBaseline + dt);
        const snapped = snapToNearestBoundary(dragged, boundaryTimes);
        lastSnappedStartRef.current = snapped;
        applyDelta(snapped);
      };
      const onUp = () => {
        const finalStart = lastSnappedStartRef.current;
        const saved = dragRef.current;
        dragRef.current = null;
        lastSnappedStartRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (finalStart != null && saved) {
          const delta = finalStart - saved.primaryBaseline;
          const ids = Object.keys(saved.baselines);
          if (ids.length <= 1) {
            moveItem(item.id, finalStart);
          } else {
            setSceneItemStartTimes(
              ids.map((id) => ({
                id,
                startTime: Math.max(0, saved.baselines[id]! + delta),
              })),
            );
          }
        }
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [
      item.id,
      item.startTime,
      pxPerSecond,
      moveItem,
      setSceneItemStartTimes,
      select,
      audioItems,
    ],
  );

  const onMouseDownResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = {
        startX: e.clientX,
        startDuration: runDuration(item, itemsMap),
      };

      const onMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return;
        const dx = ev.clientX - resizeRef.current.startX;
        const dt = dx / pxPerSecond;
        const newVisual = Math.max(0.05, resizeRef.current.startDuration + dt);
        resizeItem(item.id, newVisual);
      };
      const onUp = () => {
        resizeRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [item.id, item, itemsMap, pxPerSecond, resizeItem],
  );

  const zBase = 10 + Math.min(stackIndex, 200);
  const zIndex = isSelected ? zBase + 500 : zBase;

  const borderRing = isSelected
    ? 'ring-2 ring-blue-300 ring-offset-1 ring-offset-slate-900'
    : '';

  const segmentWaitStripes =
    item.kind === 'textLine' && segmentWaitTotal(item.segments) > 0 ? (
      (() => {
        const tl = item as TextLineItem;
        const totalSec = runDuration(tl, itemsMap);
        const animOnly = textLineAnimOnlyDuration(tl, itemsMap);
        const n = Math.max(1, tl.segments.length);
        const perAnim = animOnly / n;
        if (totalSec <= 1e-9) return null;
        return (
          <div
            className="absolute inset-0 flex flex-row pointer-events-none z-0"
            aria-hidden
          >
            {tl.segments.flatMap((seg, i) => {
              const cells: ReactNode[] = [
                <div
                  key={`a-${i}`}
                  className="h-full shrink-0 bg-white/12 min-w-[2px]"
                  style={{ width: `${(perAnim / totalSec) * 100}%` }}
                />,
              ];
              if ((seg.waitAfterSec ?? 0) > 0) {
                cells.push(
                  <div
                    key={`w-${i}`}
                    className="h-full shrink-0 bg-amber-400/40 min-w-[3px] border-l border-amber-200/30"
                    style={{
                      width: `${((seg.waitAfterSec ?? 0) / totalSec) * 100}%`,
                    }}
                    title={`Wait ${seg.waitAfterSec}s after segment ${i}`}
                  />,
                );
              }
              return cells;
            })}
          </div>
        );
      })()
    ) : null;

  return (
    <div
      className={`absolute top-1 bottom-1 flex cursor-grab select-none items-center overflow-hidden rounded-md border text-[10px] text-white truncate ${colors} ${borderRing}`}
      style={{ left: `${left}px`, width: `${width}px`, zIndex }}
      onMouseDown={onMouseDownMove}
    >
      {segmentWaitStripes}
      <span className="px-1.5 truncate pointer-events-none relative z-[1] drop-shadow-sm">
        {label}
      </span>

      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/20 rounded-r-md z-[2]"
        onMouseDown={onMouseDownResize}
      />
    </div>
  );
}
