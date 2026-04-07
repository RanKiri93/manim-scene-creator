import { useRef, useCallback } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { SceneItem } from '@/types/scene';
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
  const resizeItem = useSceneStore((s) => s.resizeItem);
  const audioItems = useSceneStore((s) => s.audioItems);

  const dragRef = useRef<{ startX: number; startTime: number } | null>(null);
  const lastSnappedStartRef = useRef<number | null>(null);
  const resizeRef = useRef<{ startX: number; startDuration: number } | null>(null);

  const left = (item.startTime - viewStart) * pxPerSecond;
  const barDuration = clipHasTimelineDuration(item) ? item.duration : 0;
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
      dragRef.current = { startX: e.clientX, startTime: item.startTime };
      lastSnappedStartRef.current = item.startTime;
      const boundaryTimes = collectAudioBoundaryTimes(audioItems);

      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const dx = ev.clientX - dragRef.current.startX;
        const dt = dx / pxPerSecond;
        const dragged = Math.max(0, dragRef.current.startTime + dt);
        const snapped = snapToNearestBoundary(dragged, boundaryTimes);
        lastSnappedStartRef.current = snapped;
        moveItem(item.id, snapped);
      };
      const onUp = () => {
        const finalStart = lastSnappedStartRef.current;
        dragRef.current = null;
        lastSnappedStartRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (finalStart != null) moveItem(item.id, finalStart);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [item.id, item.startTime, pxPerSecond, moveItem, select, audioItems],
  );

  const onMouseDownResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = { startX: e.clientX, startDuration: item.duration };

      const onMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return;
        const dx = ev.clientX - resizeRef.current.startX;
        const dt = dx / pxPerSecond;
        resizeItem(item.id, Math.max(0.05, resizeRef.current.startDuration + dt));
      };
      const onUp = () => {
        resizeRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [item.id, item.duration, pxPerSecond, resizeItem],
  );

  const zBase = 10 + Math.min(stackIndex, 200);
  const zIndex = isSelected ? zBase + 500 : zBase;

  return (
    <div
      className={`absolute top-1 bottom-1 flex cursor-grab select-none items-center overflow-hidden rounded-md border text-[10px] text-white truncate ${colors} ${isSelected ? 'ring-2 ring-blue-300 ring-offset-1 ring-offset-slate-900' : ''}`}
      style={{ left: `${left}px`, width: `${width}px`, zIndex }}
      onMouseDown={onMouseDownMove}
    >
      <span className="px-1.5 truncate pointer-events-none relative z-[1]">{label}</span>

      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/20 rounded-r-md z-[2]"
        onMouseDown={onMouseDownResize}
      />
    </div>
  );
}
