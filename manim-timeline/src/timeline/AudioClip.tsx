import { useRef, useCallback } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { boundaryTimeToSeconds, type AudioTrackItem } from '@/types/scene';
import { collectAudioBoundaryTimes, snapToNearestBoundary } from './timelineSnap';

interface AudioClipProps {
  item: AudioTrackItem;
  pxPerSecond: number;
  viewStart: number;
  stackIndex: number;
  isSelected: boolean;
}

export default function AudioClip({
  item,
  pxPerSecond,
  viewStart,
  stackIndex,
  isSelected,
}: AudioClipProps) {
  const select = useSceneStore((s) => s.select);
  const moveAudioItem = useSceneStore((s) => s.moveAudioItem);
  const audioItems = useSceneStore((s) => s.audioItems);

  const dragRef = useRef<{ startX: number; startTime: number } | null>(null);
  const lastSnappedStartRef = useRef<number | null>(null);

  const left = (item.startTime - viewStart) * pxPerSecond;
  const width = Math.max(item.duration * pxPerSecond, 4);
  const rawList = item.boundaries ?? [];
  const boundaries = rawList.map((b) => ({
    word: b.word,
    start: boundaryTimeToSeconds(b.start, item.duration),
    end: boundaryTimeToSeconds(b.end, item.duration),
  }));

  const onMouseDownMove = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      select(item.id, e.shiftKey);
      dragRef.current = { startX: e.clientX, startTime: item.startTime };
      lastSnappedStartRef.current = item.startTime;
      const boundaryTimes = collectAudioBoundaryTimes(audioItems, item.id);

      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const dx = ev.clientX - dragRef.current.startX;
        const dt = dx / pxPerSecond;
        const dragged = Math.max(0, dragRef.current.startTime + dt);
        const snapped = snapToNearestBoundary(dragged, boundaryTimes);
        lastSnappedStartRef.current = snapped;
        moveAudioItem(item.id, snapped);
      };
      const onUp = () => {
        const finalStart = lastSnappedStartRef.current;
        dragRef.current = null;
        lastSnappedStartRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (finalStart != null) moveAudioItem(item.id, finalStart);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [item.id, item.startTime, pxPerSecond, moveAudioItem, select, audioItems],
  );

  const zBase = 10 + Math.min(stackIndex, 200);
  const zIndex = isSelected ? zBase + 500 : zBase;

  return (
    <div
      className={`absolute top-0 bottom-0 cursor-grab select-none overflow-visible rounded-sm border border-slate-500/60 bg-slate-700/50 active:cursor-grabbing ${
        isSelected ? 'ring-2 ring-blue-300 ring-offset-1 ring-offset-slate-800' : ''
      }`}
      style={{ left: `${left}px`, width: `${width}px`, zIndex }}
      title={item.text}
      onMouseDown={onMouseDownMove}
    >
      <span className="pointer-events-none absolute left-0.5 top-0 z-30 max-w-[min(180px,calc(100%-4px))] truncate text-[9px] font-medium leading-tight text-slate-200 drop-shadow-sm">
        {item.text}
      </span>
      {boundaries.map((boundary, i) => {
        const raw = rawList[i];
        const startRaw = raw?.start ?? boundary.start;
        let tickLeft = startRaw * pxPerSecond;
        if (tickLeft > width + 2) {
          tickLeft = (startRaw / 1000) * pxPerSecond;
        }
        return (
          <div
            key={`${boundary.start}-${i}`}
            className="pointer-events-none absolute top-0 bottom-0 z-20 flex h-full flex-row items-stretch"
            style={{ left: `${tickLeft}px` }}
          >
            <div
              className="shrink-0 bg-cyan-400"
              style={{ width: '2px', height: '100%', zIndex: 20 }}
              aria-hidden
            />
            <span className="pointer-events-none max-w-[96px] truncate pl-1 pt-0.5 text-[8px] font-bold leading-tight text-white drop-shadow-sm">
              {boundary.word}
            </span>
          </div>
        );
      })}
    </div>
  );
}
