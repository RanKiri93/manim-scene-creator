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
      <div className="flex flex-col gap-4 text-xs text-slate-300 p-1">
        {owner ? (
          <p className="rounded border border-amber-500/40 bg-amber-950/30 px-2 py-1.5 text-amber-100 text-[10px]">
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
            <span className="rounded border border-sky-500/55 bg-sky-600/20 px-1.5 py-0.5 text-[10px] text-sky-100">
              Cleaned {item.audioProcessing.cleaned.targetLufs} LUFS
            </span>
          ) : item.audioProcessing?.normalized ? (
            <span className="rounded border border-emerald-500/55 bg-emerald-600/20 px-1.5 py-0.5 text-[10px] text-emerald-100">
              {item.audioProcessing.normalized.targetLufs} LUFS
            </span>
          ) : null}
          {isReference ? (
            <span className="rounded border border-amber-400/60 bg-amber-500/25 px-1.5 py-0.5 text-[10px] text-amber-50">
              Reference
            </span>
          ) : null}
          {item.audioProcessing?.matchedEq ? (
            <span className="rounded border border-violet-500/55 bg-violet-600/25 px-1.5 py-0.5 text-[10px] text-violet-100">
              EQ matched
            </span>
          ) : null}
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="text-slate-400 font-medium text-[11px] uppercase tracking-wide">
            Processing
          </h3>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={cleanBusy || normBusy || matchBusy || !measureEnabled}
              onClick={() => void onClean()}
              className="rounded border border-sky-500/80 bg-sky-950/80 px-3 py-1.5 text-xs text-sky-100 hover:bg-sky-900 disabled:opacity-50"
            >
              {cleanBusy ? 'Cleaning…' : 'Clean'}
            </button>
            <button
              type="button"
              disabled={normBusy || cleanBusy || matchBusy || !measureEnabled}
              onClick={() => void onNormalize()}
              className="rounded border border-slate-500/80 bg-slate-900/95 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-800 disabled:opacity-50"
            >
              {normBusy ? 'Normalizing…' : 'Normalize'}
            </button>
            <button
              type="button"
              onClick={() => setAudioReferenceId(isReference ? null : item.id)}
              className={`rounded border px-3 py-1.5 text-xs ${
                isReference
                  ? 'border-amber-400/80 bg-amber-500/30 text-amber-50'
                  : 'border-slate-500/80 bg-slate-900/95 text-slate-100 hover:bg-slate-800'
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
              className="rounded border border-violet-500/80 bg-violet-950/80 px-3 py-1.5 text-xs text-violet-100 hover:bg-violet-900 disabled:opacity-50"
            >
              {matchBusy ? 'Matching…' : 'Match EQ'}
            </button>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-slate-400 font-medium text-[11px] uppercase tracking-wide">
            Timing
          </h3>
          <div className="flex flex-wrap gap-1">
            {AUDIO_GAP_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={gapPresetsDisabled}
                onClick={() => onGapPreset(p.seconds)}
                className="min-w-[2rem] rounded border border-slate-500/70 bg-slate-900/95 px-2 py-1 text-xs font-semibold text-slate-100 hover:bg-slate-800 disabled:opacity-40"
                title={gapPresetTitle(p)}
              >
                {p.shortLabel}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-slate-500">
            T/N/I/R gap presets. With multiple unlinked clips selected, spaces all selected clips.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-slate-400 font-medium text-[11px] uppercase tracking-wide">
              Bookmarks / transcript
            </h3>
            <span className="text-[10px] text-slate-500">{boundaries.length} marks</span>
          </div>
          {boundaries.length === 0 ? (
            <p className="rounded border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-[10px] text-slate-500">
              This clip has no word boundaries to edit.
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto rounded border border-slate-700 bg-slate-950/60">
              <div className="grid grid-cols-[minmax(7rem,1fr)_4.2rem_4.2rem_8.5rem] gap-1 border-b border-slate-800 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-500">
                <span>Label</span>
                <span>Start</span>
                <span>End</span>
                <span>Nudge</span>
              </div>
              {boundaries.map((boundary, index) => (
                <div
                  key={`${boundary.word}-${index}`}
                  className="grid grid-cols-[minmax(7rem,1fr)_4.2rem_4.2rem_8.5rem] items-center gap-1 border-b border-slate-800/70 px-2 py-1 last:border-b-0"
                >
                  <input
                    value={boundary.word}
                    onChange={(e) =>
                      updateAudioBoundary(item.id, index, { word: e.target.value })
                    }
                    className="min-w-0 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[11px] text-slate-100"
                    spellCheck={false}
                    dir="auto"
                  />
                  <BoundaryTimeInput
                    value={boundary.start}
                    min={0}
                    max={item.duration}
                    onCommit={(value) => updateAudioBoundary(item.id, index, { start: value })}
                    className="rounded border border-slate-700 bg-slate-900 px-1 py-1 text-[11px] text-slate-100"
                  />
                  <BoundaryTimeInput
                    value={boundary.end}
                    min={0}
                    max={item.duration}
                    onCommit={(value) => updateAudioBoundary(item.id, index, { end: value })}
                    className="rounded border border-slate-700 bg-slate-900 px-1 py-1 text-[11px] text-slate-100"
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
                        className="rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-[10px] text-slate-200 hover:bg-slate-800"
                      >
                        {delta > 0 ? '+' : ''}
                        {Math.round(delta * 1000)}ms
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => playBoundaryRange(boundary.start, boundary.end)}
                      className="rounded border border-cyan-600/70 bg-cyan-950/70 px-1 py-0.5 text-[10px] text-cyan-100 hover:bg-cyan-900"
                    >
                      Play
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-slate-500">
            Start times are clamped between neighboring bookmarks. Use nudges for small Whisper
            timing fixes.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-slate-400 font-medium text-[11px] uppercase tracking-wide">
            Export fades (ms)
          </h3>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1">
              <span className="text-slate-500">In</span>
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
                className="w-16 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-slate-200"
              />
            </label>
            <label className="flex items-center gap-1">
              <span className="text-slate-500">Out</span>
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
                className="w-16 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-slate-200"
              />
            </label>
          </div>
          <p className="text-[10px] text-slate-500">
            Empty fields use scene default ({effectiveFadeIn} ms). Applied at export mixdown.
          </p>
        </section>

        {normErr ? (
          <p className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1.5 text-red-300 text-[10px]">
            {normErr}
          </p>
        ) : null}
      </div>
    </FloatingPanel>
  );
}
