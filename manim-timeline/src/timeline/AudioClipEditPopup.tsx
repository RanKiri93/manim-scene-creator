import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FloatingPanel from '@/components/FloatingPanel';
import { useSceneStore } from '@/store/useSceneStore';
import { usePreviewMergedItems } from '@/agent/previewSelectors';
import { explicitVisualOwnerForAudioTrack } from '@/lib/audioBinding';
import { itemClipDisplayName } from '@/lib/itemDisplayName';
import { getAudioBoundaries } from '@/types/scene';
import {
  AUDIO_GAP_PRESETS,
  findPreviousAudioEndingBefore,
} from '@/lib/audioGapPresets';

type AudioClipEditPopupProps = {
  clipId: string;
  onClose: () => void;
};

function BoundaryTimeInput(props: {
  value: number;
  min?: number;
  max?: number;
  onCommit: (value: number) => void;
  className?: string;
}) {
  const { value, min = 0, max, onCommit, className } = props;
  const [draft, setDraft] = useState(() => value.toFixed(2));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(value.toFixed(2));
  }, [value]);

  const commit = useCallback(() => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(value.toFixed(2));
      return;
    }
    const clamped = Math.min(Math.max(parsed, min), max ?? parsed);
    onCommit(clamped);
    setDraft(clamped.toFixed(2));
  }, [draft, max, min, onCommit, value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focusedRef.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setDraft(value.toFixed(2));
          e.currentTarget.blur();
        }
      }}
      className={className}
    />
  );
}

export default function AudioClipEditPopup({ clipId, onClose }: AudioClipEditPopupProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewStopAtRef = useRef<number | null>(null);
  const previewStopTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const item = useSceneStore((s) => s.audioItems.find((a) => a.id === clipId));
  const isTimelinePlaying = useSceneStore((s) => s.isPlaying);
  const sceneDefaults = useSceneStore((s) => s.defaults);
  const normalizeAudioTrack = useSceneStore((s) => s.normalizeAudioTrack);
  const processAudioTrack = useSceneStore((s) => s.processAudioTrack);
  const matchAudioTrackEq = useSceneStore((s) => s.matchAudioTrackEq);
  const setAudioReferenceId = useSceneStore((s) => s.setAudioReferenceId);
  const setAudioClipFades = useSceneStore((s) => s.setAudioClipFades);
  const updateAudioBoundary = useSceneStore((s) => s.updateAudioBoundary);
  const audioReferenceId = useSceneStore((s) => s.audioReferenceId);
  const placeAudioAfterPrevious = useSceneStore((s) => s.placeAudioAfterPrevious);
  const spaceSelectedAudioItems = useSceneStore((s) => s.spaceSelectedAudioItems);
  const measureEnabled = useSceneStore((s) => s.measureConfig.enabled);
  const selectedIds = useSceneStore((s) => s.selectedIds);
  const audioItems = useSceneStore((s) => s.audioItems);
  const itemsMap = usePreviewMergedItems();

  const [normBusy, setNormBusy] = useState(false);
  const [cleanBusy, setCleanBusy] = useState(false);
  const [matchBusy, setMatchBusy] = useState(false);
  const [normErr, setNormErr] = useState<string | null>(null);

  const owner = useMemo(
    () => (item ? explicitVisualOwnerForAudioTrack(itemsMap, item.id) : null),
    [itemsMap, item],
  );

  const isReference = item != null && audioReferenceId === item.id;
  const hasReference = audioReferenceId != null;

  const effectiveFadeIn = item
    ? item.fadeInMs ?? sceneDefaults.audioCutFadeMs ?? 0
    : 0;
  const effectiveFadeOut = item
    ? item.fadeOutMs ?? sceneDefaults.audioCutFadeMs ?? 0
    : 0;

  const selectedAudioCount = useMemo(() => {
    let n = 0;
    for (const id of selectedIds) {
      if (audioItems.some((a) => a.id === id)) n += 1;
    }
    return n;
  }, [selectedIds, audioItems]);

  const unlinkedSelectedAudioCount = useMemo(() => {
    let n = 0;
    for (const id of selectedIds) {
      const a = audioItems.find((x) => x.id === id);
      if (!a) continue;
      if (!explicitVisualOwnerForAudioTrack(itemsMap, a.id)) n += 1;
    }
    return n;
  }, [selectedIds, audioItems, itemsMap]);

  const hasPreviousAudio = useMemo(
    () => (item ? findPreviousAudioEndingBefore(audioItems, item.id) != null : false),
    [audioItems, item],
  );
  const boundaries = useMemo(() => (item ? getAudioBoundaries(item) : []), [item]);

  const gapPresetsDisabled =
    !item ||
    Boolean(owner) ||
    (selectedAudioCount >= 2 && unlinkedSelectedAudioCount < 2) ||
    (selectedAudioCount === 1 && !hasPreviousAudio);

  const gapPresetTitle = (p: (typeof AUDIO_GAP_PRESETS)[number]) => {
    if (owner) {
      return 'Linked audio follows its visual clip — unbind to set gaps manually.';
    }
    if (selectedAudioCount >= 2 && unlinkedSelectedAudioCount < 2) {
      return 'Need at least two selected clips that are not linked to visuals.';
    }
    if (selectedAudioCount >= 2) {
      return `Space ${unlinkedSelectedAudioCount} narration clip(s): ${p.label} (${p.seconds}s between clips)`;
    }
    if (!hasPreviousAudio) {
      return 'No earlier audio on the timeline to place after.';
    }
    return `After previous clip + ${p.seconds}s gap (${p.label})`;
  };

  const onClean = useCallback(async () => {
    if (!item) return;
    setNormErr(null);
    setCleanBusy(true);
    try {
      await processAudioTrack(item.id);
    } catch (err) {
      setNormErr(err instanceof Error ? err.message : String(err));
    } finally {
      setCleanBusy(false);
    }
  }, [processAudioTrack, item]);

  const onNormalize = useCallback(async () => {
    if (!item) return;
    setNormErr(null);
    setNormBusy(true);
    try {
      await normalizeAudioTrack(item.id);
    } catch (err) {
      setNormErr(err instanceof Error ? err.message : String(err));
    } finally {
      setNormBusy(false);
    }
  }, [normalizeAudioTrack, item]);

  const onMatchEq = useCallback(async () => {
    if (!item) return;
    setNormErr(null);
    setMatchBusy(true);
    try {
      await matchAudioTrackEq(item.id);
    } catch (err) {
      setNormErr(err instanceof Error ? err.message : String(err));
    } finally {
      setMatchBusy(false);
    }
  }, [matchAudioTrackEq, item]);

  const onGapPreset = useCallback(
    (gapSec: number) => {
      if (!item || owner) return;
      if (selectedAudioCount >= 2) {
        spaceSelectedAudioItems(gapSec);
      } else {
        placeAudioAfterPrevious(item.id, gapSec);
      }
    },
    [item, owner, selectedAudioCount, spaceSelectedAudioItems, placeAudioAfterPrevious],
  );

  const clearBoundaryPreview = useCallback(() => {
    if (previewStopTimerRef.current != null) {
      window.clearTimeout(previewStopTimerRef.current);
      previewStopTimerRef.current = null;
    }
    previewStopAtRef.current = null;
  }, []);

  const stopBoundaryPreview = useCallback((audio: HTMLAudioElement, stopAt: number) => {
    if (previewStopTimerRef.current != null) {
      window.clearTimeout(previewStopTimerRef.current);
      previewStopTimerRef.current = null;
    }
    previewStopAtRef.current = null;
    audio.pause();
    audio.currentTime = Math.min(Math.max(0, stopAt), Number.isFinite(audio.duration) ? audio.duration : stopAt);
  }, []);

  useEffect(() => {
    if (isTimelinePlaying) {
      clearBoundaryPreview();
      audioRef.current?.pause();
    }
  }, [clearBoundaryPreview, isTimelinePlaying]);

  useEffect(() => () => clearBoundaryPreview(), [clearBoundaryPreview]);

  const playBoundaryRange = useCallback((start: number, end: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    clearBoundaryPreview();
    const safeStart = Math.max(0, start);
    const stopAt = Math.max(safeStart + 0.01, end);
    previewStopAtRef.current = stopAt;
    audio.currentTime = safeStart;
    void audio.play();
    previewStopTimerRef.current = window.setTimeout(
      () => {
        const currentAudio = audioRef.current;
        if (currentAudio) stopBoundaryPreview(currentAudio, stopAt);
      },
      Math.max(20, (stopAt - safeStart) * 1000),
    );
  }, [clearBoundaryPreview, stopBoundaryPreview]);

  if (!item) {
    return null;
  }

  const title = item.text.trim() || `Audio ${item.id.slice(0, 8)}`;

  return (
    <FloatingPanel title={`Edit audio — ${title}`} onClose={onClose} defaultSize={{ w: 400, h: 520 }}>
      <div className="flex flex-col gap-4 text-ctl text-chalk-dim p-1">
        {owner ? (
          <p className="rounded-ctl border border-warn/45 bg-warn/10 px-2 py-1.5 text-warn text-meta">
            Linked to: {itemClipDisplayName(owner)}. Timing follows the visual clip.
          </p>
        ) : null}

        <audio
          ref={audioRef}
          controls
          src={item.audioUrl}
          className="w-full h-9"
          onTimeUpdate={(e) => {
            const stopAt = previewStopAtRef.current;
            const audio = e.currentTarget;
            if (stopAt != null && audio.currentTime >= stopAt) {
              stopBoundaryPreview(audio, stopAt);
            }
          }}
          onPause={clearBoundaryPreview}
          onEnded={clearBoundaryPreview}
        />

        <div className="flex flex-wrap gap-1">
          {item.audioProcessing?.cleaned ? (
            <span className="rounded-ctl border border-highlight/60 bg-raised px-1.5 py-0.5 text-meta text-chalk">
              Cleaned {item.audioProcessing.cleaned.targetLufs} LUFS
            </span>
          ) : item.audioProcessing?.normalized ? (
            <span className="rounded-ctl border border-kind-axes/50 bg-kind-axes/10 px-1.5 py-0.5 text-meta text-kind-axes">
              {item.audioProcessing.normalized.targetLufs} LUFS
            </span>
          ) : null}
          {isReference ? (
            <span className="rounded-ctl border border-warn/45 bg-warn/10 px-1.5 py-0.5 text-meta text-warn">
              Reference
            </span>
          ) : null}
          {item.audioProcessing?.matchedEq ? (
            <span className="rounded-ctl border border-highlight/60 bg-raised px-1.5 py-0.5 text-meta text-chalk">
              EQ matched
            </span>
          ) : null}
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="text-chalk-dim font-medium text-meta ">
            Processing
          </h3>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={cleanBusy || normBusy || matchBusy || !measureEnabled}
              onClick={() => void onClean()}
              className="rounded-ctl border border-highlight/60 bg-raised px-3 py-1.5 text-ctl text-chalk hover:bg-rule disabled:opacity-50"
            >
              {cleanBusy ? 'Cleaning…' : 'Clean'}
            </button>
            <button
              type="button"
              disabled={normBusy || cleanBusy || matchBusy || !measureEnabled}
              onClick={() => void onNormalize()}
              className="rounded-ctl border border-rule bg-ink/95 px-3 py-1.5 text-ctl text-chalk hover:bg-rule disabled:opacity-50"
            >
              {normBusy ? 'Normalizing…' : 'Normalize'}
            </button>
            <button
              type="button"
              onClick={() => setAudioReferenceId(isReference ? null : item.id)}
              className={`rounded-ctl border px-3 py-1.5 text-ctl ${
                isReference
                  ? 'border-warn/45 bg-warn/10 text-warn'
                  : 'border-rule bg-ink/95 text-chalk hover:bg-rule'
              }`}
            >
              {isReference ? 'Ref ✓' : 'Set as ref'}
            </button>
            <button
              type="button"
              disabled={
                matchBusy || cleanBusy || normBusy || !measureEnabled || !hasReference || isReference
              }
              onClick={() => void onMatchEq()}
              className="rounded-ctl border border-highlight/60 bg-raised px-3 py-1.5 text-ctl text-chalk hover:bg-rule disabled:opacity-50"
            >
              {matchBusy ? 'Matching…' : 'Match EQ'}
            </button>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-chalk-dim font-medium text-meta ">
            Timing
          </h3>
          <div className="flex flex-wrap gap-1">
            {AUDIO_GAP_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={gapPresetsDisabled}
                onClick={() => onGapPreset(p.seconds)}
                className="min-w-[2rem] rounded-ctl border border-rule bg-ink/95 px-2 py-1 text-ctl font-semibold text-chalk hover:bg-rule disabled:opacity-40"
                title={gapPresetTitle(p)}
              >
                {p.shortLabel}
              </button>
            ))}
          </div>
          <p className="text-meta text-chalk-faint">
            T/N/I/R gap presets. With multiple unlinked clips selected, spaces all selected clips.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-chalk-dim font-medium text-meta ">
              Bookmarks / transcript
            </h3>
            <span className="text-meta text-chalk-faint">{boundaries.length} marks</span>
          </div>
          {boundaries.length === 0 ? (
            <p className="rounded-ctl border border-rule bg-ink/60 px-2 py-1.5 text-meta text-chalk-faint">
              This clip has no word boundaries to edit.
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto rounded-ctl border border-rule bg-ink/60">
              <div className="grid grid-cols-[minmax(7rem,1fr)_4.2rem_4.2rem_8.5rem] gap-1 border-b border-rule px-2 py-1 text-meta text-chalk-faint">
                <span>Label</span>
                <span>Start</span>
                <span>End</span>
                <span>Nudge</span>
              </div>
              {boundaries.map((boundary, index) => (
                <div
                  key={`${boundary.word}-${index}`}
                  className="grid grid-cols-[minmax(7rem,1fr)_4.2rem_4.2rem_8.5rem] items-center gap-1 border-b border-rule px-2 py-1 last:border-b-0"
                >
                  <input
                    value={boundary.word}
                    onChange={(e) =>
                      updateAudioBoundary(item.id, index, { word: e.target.value })
                    }
                    className="min-w-0 rounded-ctl border border-rule bg-ink px-1.5 py-1 text-meta text-chalk"
                    spellCheck={false}
                    dir="auto"
                  />
                  <BoundaryTimeInput
                    value={boundary.start}
                    min={0}
                    max={item.duration}
                    onCommit={(value) => updateAudioBoundary(item.id, index, { start: value })}
                    className="rounded-ctl border border-rule bg-ink px-1 py-1 text-meta text-chalk"
                  />
                  <BoundaryTimeInput
                    value={boundary.end}
                    min={0}
                    max={item.duration}
                    onCommit={(value) => updateAudioBoundary(item.id, index, { end: value })}
                    className="rounded-ctl border border-rule bg-ink px-1 py-1 text-meta text-chalk"
                  />
                  <div className="flex flex-wrap gap-1">
                    {[-0.1, -0.05, 0.05, 0.1].map((delta) => (
                      <button
                        key={delta}
                        type="button"
                        onClick={() =>
                          updateAudioBoundary(item.id, index, {
                            start: boundary.start + delta,
                          })
                        }
                        className="rounded-ctl border border-rule bg-ink px-1 py-0.5 text-meta text-chalk hover:bg-rule"
                      >
                        {delta > 0 ? '+' : ''}
                        {Math.round(delta * 1000)}ms
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => playBoundaryRange(boundary.start, boundary.end)}
                      className="rounded-ctl border border-highlight/60 bg-raised px-1 py-0.5 text-meta text-kind-graph hover:bg-rule"
                    >
                      Play
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-meta text-chalk-faint">
            Start times are clamped between neighboring bookmarks. Use nudges for small Whisper
            timing fixes.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-chalk-dim font-medium text-meta ">
            Export fades (ms)
          </h3>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1">
              <span className="text-chalk-faint">In</span>
              <input
                type="number"
                min={0}
                max={500}
                step={5}
                value={item.fadeInMs ?? ''}
                placeholder={String(effectiveFadeIn)}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  setAudioClipFades(item.id, {
                    fadeInMs: raw === '' ? undefined : Math.max(0, Number(raw)),
                  });
                }}
                className="w-16 rounded-ctl border border-rule bg-ink px-2 py-1 text-chalk"
              />
            </label>
            <label className="flex items-center gap-1">
              <span className="text-chalk-faint">Out</span>
              <input
                type="number"
                min={0}
                max={500}
                step={5}
                value={item.fadeOutMs ?? ''}
                placeholder={String(effectiveFadeOut)}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  setAudioClipFades(item.id, {
                    fadeOutMs: raw === '' ? undefined : Math.max(0, Number(raw)),
                  });
                }}
                className="w-16 rounded-ctl border border-rule bg-ink px-2 py-1 text-chalk"
              />
            </label>
          </div>
          <p className="text-meta text-chalk-faint">
            Empty fields use scene default ({effectiveFadeIn} ms). Applied at export mixdown.
          </p>
        </section>

        {normErr ? (
          <p className="rounded-ctl border border-danger/50 bg-danger/10 px-2 py-1.5 text-danger text-meta">
            {normErr}
          </p>
        ) : null}
      </div>
    </FloatingPanel>
  );
}
