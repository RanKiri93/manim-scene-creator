import { useRef, useCallback } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { getAudioBoundaries, type AudioTrackItem, type SceneItem } from '@/types/scene';

const SNAP_THRESHOLD = 0.15;

function collectAudioBoundaryTimes(audioItems: AudioTrackItem[]): number[] {
  const out: number[] = [];
  for (const a of audioItems) {
    for (const b of getAudioBoundaries(a)) {
      out.push(a.startTime + b.start);
    }
  }
  return out;
}

function snapToNearestBoundary(t: number, boundaries: number[]): number {
  if (boundaries.length === 0) return t;
  let closest = boundaries[0];
  let best = Math.abs(t - closest);
  for (let i = 1; i < boundaries.length; i++) {
    const d = Math.abs(t - boundaries[i]);
    if (d < best) {
      best = d;
      closest = boundaries[i];
    }
  }
  return best < SNAP_THRESHOLD ? closest : t;
}

interface TimelineClipProps {
  item: SceneItem;
  pxPerSecond: number;
  viewStart: number;
  isSelected: boolean;
}

const KIND_COLORS: Record<string, string> = {
  textLine: 'bg-blue-600/80 border-blue-400',
  graph: 'bg-emerald-600/80 border-emerald-400',
  compound: 'bg-violet-600/80 border-violet-400',
};

export default function TimelineClip({
  item,
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
  const width = Math.max(item.duration * pxPerSecond, 16);

  const exitRunTime =
    item.kind === 'textLine' || item.kind === 'graph'
      ? (item.exitRunTime ?? 0)
      : 0;
  const waitAfter = item.waitAfter ?? 0;
  const runDuration =
    item.kind === 'textLine' || item.kind === 'graph' ? item.duration : 0;
  const totalEffectiveDuration =
    item.kind === 'textLine' || item.kind === 'graph'
      ? runDuration + waitAfter + exitRunTime
      : runDuration + waitAfter;
  const showExitStripe =
    (item.kind === 'textLine' || item.kind === 'graph') &&
    exitRunTime > 0 &&
    item.exitAnimStyle !== 'none';
  const exitStripeWidthPx =
    showExitStripe && totalEffectiveDuration > 0
      ? Math.max(2, width * (exitRunTime / totalEffectiveDuration))
      : 0;

  const label = (() => {
    if (item.label) return item.label;
    switch (item.kind) {
      case 'textLine':
        return item.raw.slice(0, 20);
      case 'graph':
        return 'Graph';
      case 'compound':
        return `Compound (${item.childIds.length})`;
    }
  })();

  const colors = KIND_COLORS[item.kind] ?? 'bg-slate-600/80 border-slate-400';

  // Drag to move
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

  // Drag right edge to resize
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

  return (
    <div
      className={`absolute top-1 bottom-1 rounded-md border text-[10px] text-white truncate cursor-grab select-none flex items-center relative overflow-hidden ${colors} ${isSelected ? 'ring-2 ring-blue-300 ring-offset-1 ring-offset-slate-900' : ''}`}
      style={{ left: `${left}px`, width: `${width}px` }}
      onMouseDown={onMouseDownMove}
    >
      <span className="px-1.5 truncate pointer-events-none relative z-[1]">{label}</span>

      {showExitStripe && exitStripeWidthPx > 0 ? (
        <div
          className="absolute top-0 bottom-0 pointer-events-none z-0 opacity-60 border-l border-white/30"
          style={{
            right: 8,
            width: exitStripeWidthPx,
            backgroundImage:
              'repeating-linear-gradient(-45deg, rgba(255,255,255,0.22) 0px, rgba(255,255,255,0.22) 3px, transparent 3px, transparent 6px)',
          }}
          aria-hidden
        />
      ) : null}

      {/* Resize handle (right edge) */}
      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/20 rounded-r-md z-[2]"
        onMouseDown={onMouseDownResize}
      />
    </div>
  );
}
