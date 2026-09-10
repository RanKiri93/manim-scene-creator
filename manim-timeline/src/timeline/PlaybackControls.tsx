import { useMemo, useState, useCallback, useEffect, type CSSProperties } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { functionSeriesHasErrors, pointSequenceHasErrors } from '@/types/scene';
import { kickTimelineAudioSyncNow } from './timelineAudioController';
import TimelineSurgeryDialog from './TimelineSurgeryDialog';

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
  const itemsMap = useSceneStore((s) => s.items);
  const getSceneDuration = useSceneStore((s) => s.getSceneDuration);

  const audioItemCount = useSceneStore((s) => s.audioItems.length);
  const audioReferenceId = useSceneStore((s) => s.audioReferenceId);
  const audioBatch = useSceneStore((s) => s.audioBatch);
  const measureEnabled = useSceneStore((s) => s.measureConfig.enabled);
  const normalizeAllAudioTracks = useSceneStore((s) => s.normalizeAllAudioTracks);
  const matchAllAudioTracksToReference = useSceneStore(
    (s) => s.matchAllAudioTracksToReference,
  );

  const [surgeryDialogOpen, setSurgeryDialogOpen] = useState(false);

  const duration = useMemo(() => getSceneDuration(), [getSceneDuration, itemsMap]);

  // Global playback is locked while any function series or point sequence has validation errors
  const fsErrorLabels = useMemo(() => {
    const labels: string[] = [];
    for (const it of itemsMap.values()) {
      if (it.kind === 'graphFunctionSeries' && functionSeriesHasErrors(it)) {
        labels.push(it.label?.trim() || `#${it.id.slice(0, 4)} (series)`);
      }
      if (it.kind === 'graphPointSequence' && pointSequenceHasErrors(it)) {
        labels.push(it.label?.trim() || `#${it.id.slice(0, 4)} (points)`);
      }
    }
    return labels;
  }, [itemsMap]);
  const playbackLocked = fsErrorLabels.length > 0;
  const lockedTitle = playbackLocked
    ? `ינעל עד לתיקון שגיאה בטור הפונקציות או רצף נקודות (${fsErrorLabels.join(', ')})`
    : undefined;

  // If a validation error is introduced while playback is running (e.g. the user
  // edits a formula mid-play), pause immediately so we don't keep advancing time
  // over a broken scene.
  useEffect(() => {
    if (playbackLocked && isPlaying) {
      useSceneStore.getState().pause();
    }
  }, [playbackLocked, isPlaying]);

  const onTogglePlayback = useCallback(() => {
    togglePlayback();
    // Run the audio sync while still inside the click event so desktop/web autoplay policy treats
    // the shared timeline audio element as user-initiated.
    if (!isPlaying) kickTimelineAudioSyncNow();
  }, [isPlaying, togglePlayback]);

  return (
    <div className="relative z-30 flex flex-wrap items-center gap-3 px-3 py-2 bg-slate-800 border-t border-slate-700">
      {/* Play/Pause */}
      <button
        onClick={onTogglePlayback}
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

      {/* Jump to start */}
      <button
        onClick={() => setCurrentTime(0)}
        className="w-8 h-8 flex items-center justify-center rounded-md bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors text-xs"
        title="Jump to start (0s)"
        aria-label="Jump to start (0s)"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <rect x="1" y="2" width="2" height="10" rx="0.5" />
          <polygon points="12,2 5,7 12,12" />
        </svg>
      </button>

      <button
        type="button"
        onClick={() => setSurgeryDialogOpen((v) => !v)}
        className="rounded-md bg-slate-700 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-600"
        title="Close an empty time range or insert empty time (shifts later clips and audio)"
        aria-expanded={surgeryDialogOpen}
      >
        Timeline edit…
      </button>

      {/* Batch audio processing */}
      {measureEnabled && audioItemCount > 0 ? (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={audioBatch != null}
            onClick={() => void normalizeAllAudioTracks()}
            className="rounded-md bg-slate-700 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
            title="Loudness-normalize every audio clip in this scene to a consistent level (safe to re-run)"
          >
            Normalize all
          </button>
          <button
            type="button"
            disabled={audioBatch != null || audioReferenceId == null}
            onClick={() => {
              void matchAllAudioTracksToReference().catch(() => {});
            }}
            className="rounded-md bg-slate-700 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
            title={
              audioReferenceId == null
                ? 'Set a reference clip first — use "Set as ref" on the clip whose tone you like'
                : 'Tonally match every other clip in this scene to the reference, then level them (safe to re-run)'
            }
          >
            Match all → ref
          </button>
          {audioBatch ? (
            <span className="font-mono text-[10px] text-amber-300/90">
              {audioBatch.kind === 'normalize' ? 'Normalizing' : 'Matching'} {audioBatch.done}/
              {audioBatch.total}
              {audioBatch.failed > 0 ? ` (${audioBatch.failed} failed)` : ''}…
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Time display */}
      <span className="text-xs text-slate-400 font-mono min-w-[100px]">
        {formatTime(currentTime)} / {formatTime(duration || 0)}
      </span>

      {/* Scrubber */}
      <input
        type="range"
        aria-label="Seek timeline"
        min={0}
        max={Math.max(duration, 1)}
        step={0.01}
        value={currentTime}
        onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
        className="timeline-scrubber"
        style={
          {
            '--scrubber-progress': `${
              duration > 0
                ? Math.min(100, Math.max(0, (currentTime / Math.max(duration, 1)) * 100))
                : 0
            }%`,
          } as CSSProperties
        }
      />

      {surgeryDialogOpen ? (
        <TimelineSurgeryDialog onClose={() => setSurgeryDialogOpen(false)} />
      ) : null}
    </div>
  );
}
