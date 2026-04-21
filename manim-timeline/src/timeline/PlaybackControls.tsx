import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import NumberInput from '@/components/NumberInput';
import { isTopLevelItem } from '@/lib/time';
import { functionSeriesHasErrors } from '@/types/scene';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

export default function PlaybackControls() {
  const currentTime = useSceneStore((s) => s.currentTime);
  const isPlaying = useSceneStore((s) => s.isPlaying);
  const togglePlayback = useSceneStore((s) => s.togglePlayback);
  const setCurrentTime = useSceneStore((s) => s.setCurrentTime);
  const closeGap = useSceneStore((s) => s.closeGap);
  const itemsMap = useSceneStore((s) => s.items);
  const getSceneDuration = useSceneStore((s) => s.getSceneDuration);

  const [gapDialogOpen, setGapDialogOpen] = useState(false);
  const [gapStart, setGapStart] = useState(0);
  const [gapEnd, setGapEnd] = useState(5);
  const [gapHint, setGapHint] = useState<string | null>(null);
  const gapHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (gapHintTimer.current) clearTimeout(gapHintTimer.current);
    };
  }, []);

  const duration = useMemo(() => getSceneDuration(), [getSceneDuration, itemsMap]);

  // Global playback is locked while any function series has validation errors —
  // rendering a broken series at playback time would produce an incorrect scene
  // and the export is already hard-blocked for the same reason.
  const fsErrorLabels = useMemo(() => {
    const labels: string[] = [];
    for (const it of itemsMap.values()) {
      if (it.kind === 'graphFunctionSeries' && functionSeriesHasErrors(it)) {
        labels.push(it.label?.trim() || `#${it.id.slice(0, 4)}`);
      }
    }
    return labels;
  }, [itemsMap]);
  const playbackLocked = fsErrorLabels.length > 0;
  const lockedTitle = playbackLocked
    ? `ינעל עד לתיקון שגיאה בטור הפונקציות (${fsErrorLabels.join(', ')})`
    : undefined;

  // If a validation error is introduced while playback is running (e.g. the user
  // edits a formula mid-play), pause immediately so we don't keep advancing time
  // over a broken scene.
  useEffect(() => {
    if (playbackLocked && isPlaying) {
      useSceneStore.getState().pause();
    }
  }, [playbackLocked, isPlaying]);

  const openGapDialog = useCallback(() => {
    const t = useSceneStore.getState().currentTime;
    setGapStart(t);
    setGapEnd(t + 5);
    setGapDialogOpen(true);
  }, []);

  const applyCloseGap = useCallback(() => {
    if (!(gapEnd > gapStart)) return;
    const state = useSceneStore.getState();
    let wouldMove = 0;
    for (const it of state.items.values()) {
      if (isTopLevelItem(it) && it.startTime >= gapEnd) wouldMove++;
    }
    for (const a of state.audioItems) {
      if (a.startTime >= gapEnd) wouldMove++;
    }
    closeGap(gapStart, gapEnd);
    setGapDialogOpen(false);
    if (wouldMove === 0) {
      if (gapHintTimer.current) clearTimeout(gapHintTimer.current);
      setGapHint('Nothing moved — set gap end to the first start time of the block you want to pull left.');
      gapHintTimer.current = setTimeout(() => {
        setGapHint(null);
        gapHintTimer.current = null;
      }, 5000);
    } else {
      setGapHint(null);
    }
  }, [closeGap, gapStart, gapEnd]);

  return (
    <div className="relative z-30 flex flex-wrap items-center gap-3 px-3 py-2 bg-slate-800 border-t border-slate-700">
      {/* Play/Pause */}
      <button
        onClick={togglePlayback}
        disabled={playbackLocked && !isPlaying}
        className="w-8 h-8 flex items-center justify-center rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-600 disabled:hover:bg-slate-600 disabled:opacity-60"
        aria-label={isPlaying ? 'Pause' : 'Play'}
        aria-disabled={playbackLocked && !isPlaying}
        title={lockedTitle}
      >
        {isPlaying ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <rect x="2" y="1" width="4" height="12" rx="1" />
            <rect x="8" y="1" width="4" height="12" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <polygon points="2,1 12,7 2,13" />
          </svg>
        )}
      </button>

      {/* Rewind */}
      <button
        onClick={() => setCurrentTime(0)}
        className="w-8 h-8 flex items-center justify-center rounded-md bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors text-xs"
        title="Rewind to start"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <rect x="1" y="2" width="2" height="10" rx="0.5" />
          <polygon points="5,2 12,7 5,12" />
        </svg>
      </button>

      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          onClick={openGapDialog}
          className="rounded-md bg-slate-700 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-600"
          title="Shift clips and audio that start at or after the gap end, left by the gap length"
        >
          Close gap…
        </button>
        {gapHint ? (
          <span className="max-w-[220px] text-[10px] leading-tight text-amber-400/95">{gapHint}</span>
        ) : null}
      </div>

      {/* Time display */}
      <span className="text-xs text-slate-400 font-mono min-w-[100px]">
        {formatTime(currentTime)} / {formatTime(duration || 0)}
      </span>

      {/* Scrubber */}
      <input
        type="range"
        min={0}
        max={Math.max(duration, 1)}
        step={0.01}
        value={currentTime}
        onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
        className="flex-1 accent-blue-500 h-1.5 cursor-pointer"
      />

      {gapDialogOpen ? (
        <div
          className="absolute left-3 right-3 top-full z-50 mt-1 max-h-[min(280px,50vh)] overflow-y-auto rounded-lg border border-slate-600 bg-slate-900 p-3 shadow-xl"
          role="dialog"
          aria-label="Close timeline gap"
        >
          <p className="mb-2 text-[11px] text-slate-400">
            Removes time <span className="text-slate-300">[gap start, gap end)</span>. Every top-level
            clip and audio track with start ≥ gap end moves left by (gap end − gap start). Best if
            nothing starts inside the gap.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <NumberInput label="Gap start (s)" value={gapStart} onChange={setGapStart} min={0} step={0.1} />
            <NumberInput label="Gap end (s)" value={gapEnd} onChange={setGapEnd} min={0} step={0.1} />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={applyCloseGap}
                disabled={!(gapEnd > gapStart)}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => setGapDialogOpen(false)}
                className="rounded-md bg-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-600"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
