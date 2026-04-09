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
  const setAudioItemStartTimes = useSceneStore((s) => s.setAudioItemStartTimes);
  const removeAudioItem = useSceneStore((s) => s.removeAudioItem);
  const audioItems = useSceneStore((s) => s.audioItems);

  const dragRef = useRef<{
    startX: number;
    primaryBaseline: number;
    baselines: Record<string, number>;
  } | null>(null);
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
      const state = useSceneStore.getState();
      const baselines: Record<string, number> = {};
      for (const id of state.selectedIds) {
        const track = state.audioItems.find((a) => a.id === id);
        if (track) baselines[id] = track.startTime;
      }
      baselines[item.id] =
        state.audioItems.find((a) => a.id === item.id)?.startTime ?? item.startTime;
      dragRef.current = {
        startX: e.clientX,
        primaryBaseline: baselines[item.id]!,
        baselines,
      };
      lastSnappedStartRef.current = baselines[item.id]!;
      const boundaryTimes = collectAudioBoundaryTimes(audioItems, item.id);

      const applyDelta = (primarySnapped: number) => {
        const d = dragRef.current;
        if (!d) return;
        const delta = primarySnapped - d.primaryBaseline;
        const ids = Object.keys(d.baselines);
        if (ids.length <= 1) {
          moveAudioItem(item.id, primarySnapped);
          return;
        }
        setAudioItemStartTimes(
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
            moveAudioItem(item.id, finalStart);
          } else {
            setAudioItemStartTimes(
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
      moveAudioItem,
      setAudioItemStartTimes,
      select,
      audioItems,
      removeAudioItem,
    ],
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
      <button
        type="button"
        className="absolute right-0.5 top-0.5 z-40 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-slate-900/90 text-slate-400 hover:bg-red-900/90 hover:text-red-100 border border-slate-600/80"
        title="Remove audio from timeline"
        aria-label="Remove audio from timeline"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          removeAudioItem(item.id);
        }}
      >
        <span className="text-[11px] leading-none font-bold" aria-hidden>
          ×
        </span>
      </button>
      <span className="pointer-events-none absolute left-0.5 top-0 z-30 max-w-[min(180px,calc(100%-20px))] truncate text-[9px] font-medium leading-tight text-slate-200 drop-shadow-sm">
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
