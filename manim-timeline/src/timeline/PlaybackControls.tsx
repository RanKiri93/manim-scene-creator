import { useMemo, useState, useCallback, useEffect, type CSSProperties } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { functionSeriesHasErrors, pointSequenceHasErrors } from '@/types/scene';
import { resolveCameraSchedule } from '@/lib/camera';
import { kickTimelineAudioSyncNow } from './timelineAudioController';
import TimelineSurgeryDialog from './TimelineSurgeryDialog';
import { cx } from '@/lib/cx';
import { Button, IconButton, focusRing } from '@/components/ui';

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
  const frames = useSceneStore((s) => s.frames);
  const startFrameId = useSceneStore((s) => s.startFrameId);
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

  const duration = useMemo(() => getSceneDuration(), [getSceneDuration]);

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
  const cameraErrorLabels = useMemo(
    () => resolveCameraSchedule(itemsMap, frames, startFrameId).diagnostics.map((diagnostic) => {
      const item = itemsMap.get(diagnostic.clipId);
      const name = item && item.kind === 'camera_move' ? item.label.trim() || `#${item.id.slice(0, 4)} (camera)` : `#${diagnostic.clipId.slice(0, 4)} (camera)`;
      return `${name}: ${diagnostic.message}`;
    }),
    [itemsMap, frames, startFrameId],
  );
  const playbackLocked = fsErrorLabels.length > 0 || cameraErrorLabels.length > 0;
  const lockedLabel = [...fsErrorLabels, ...cameraErrorLabels].join('; ');
  const lockedTitle = playbackLocked
    ? `Playback locked: ${lockedLabel}`
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
    <div className="relative z-30 flex flex-wrap items-center gap-2.5 border-b border-rule bg-panel px-3 py-1.5">
      {/* Play/Pause */}
      <button
        type="button"
        onClick={onTogglePlayback}
        disabled={playbackLocked && !isPlaying}
        className={cx(
          'flex size-8 items-center justify-center rounded-full bg-highlight text-highlight-ink transition-colors enabled:hover:bg-highlight/90 disabled:cursor-not-allowed disabled:bg-raised disabled:text-chalk-faint',
          focusRing,
        )}
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
      <IconButton label="Jump to start" title="Jump to start (0 s)" onClick={() => setCurrentTime(0)}>
        <svg viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
          <rect x="1" y="2" width="2" height="10" rx="0.5" />
          <polygon points="12,2 5,7 12,12" />
        </svg>
      </IconButton>

      <Button
        size="sm"
        onClick={() => setSurgeryDialogOpen((v) => !v)}
        title="Close an empty time range or insert empty time (shifts later clips and audio)"
        aria-expanded={surgeryDialogOpen}
      >
        Insert or remove time…
      </Button>

      {/* Batch audio processing */}
      {measureEnabled && audioItemCount > 0 ? (
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            disabled={audioBatch != null}
            onClick={() => void normalizeAllAudioTracks()}
            title="Loudness-normalize every audio clip in this scene to a consistent level (safe to re-run)"
          >
            Normalize all
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={audioBatch != null || audioReferenceId == null}
            onClick={() => {
              void matchAllAudioTracksToReference().catch(() => {});
            }}
            title={
              audioReferenceId == null
                ? 'Set a reference clip first: use "Set as ref" on the clip whose tone you like'
                : 'Tonally match every other clip in this scene to the reference, then level them (safe to re-run)'
            }
          >
            Match all to reference
          </Button>
          {audioBatch ? (
            <span role="status" className="text-meta text-warn tabular-nums">
              {audioBatch.kind === 'normalize' ? 'Normalizing' : 'Matching'} {audioBatch.done}/
              {audioBatch.total}
              {audioBatch.failed > 0 ? ` (${audioBatch.failed} failed)` : ''}…
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Time display */}
      <span className="min-w-[112px] text-body text-chalk tabular-nums">
        {formatTime(currentTime)} <span className="text-chalk-faint">/ {formatTime(duration || 0)}</span>
      </span>
      {cameraErrorLabels.length > 0 ? (
        <span role="alert" className="max-w-[28rem] truncate text-meta text-danger" title={cameraErrorLabels.join('\n')}>
          Camera: {cameraErrorLabels.join('; ')}
        </span>
      ) : null}

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
