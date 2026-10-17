import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FloatingPanel from '@/components/FloatingPanel';
import { useSceneStore } from '@/store/useSceneStore';
import { usePreviewMergedItems } from '@/agent/previewSelectors';
import { explicitVisualOwnerForAudioTrack } from '@/lib/audioBinding';
import { itemClipDisplayName } from '@/lib/itemDisplayName';
import { getAudioBoundaries } from '@/types/scene';
import { MIN_CLIP_SEC, clipFileLength, clipSourceIn, isEditedClip, wordRangeCut } from '@/lib/audioEdit';
import { dbToGain } from '@/lib/audioSchedule';
import { playAudioPreview, stopAudioPreview } from './audioBuffers';
import {
  copyAudioSelection,
  cutAudioSelection,
  deleteAudioSelection,
  useAudioEditSession,
} from './audioEditSession';
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
  const [previewing, setPreviewing] = useState<'clip' | number | null>(null);
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
  const splitAudioAt = useSceneStore((s) => s.splitAudioAt);
  const setAudioClipGain = useSceneStore((s) => s.setAudioClipGain);
  const playheadTime = useSceneStore((s) => s.currentTime);
  const range = useAudioEditSession((st) => (st.range?.clipId === clipId ? st.range : null));
  const setRange = useAudioEditSession((st) => st.setRange);
  const [wordAnchorIndex, setWordAnchorIndex] = useState<number | null>(null);
  const playheadInside =
    item != null &&
    playheadTime > item.startTime + MIN_CLIP_SEC &&
    playheadTime < item.startTime + item.duration - MIN_CLIP_SEC;

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

  useEffect(() => {
    if (isTimelinePlaying) stopAudioPreview();
  }, [isTimelinePlaying]);

  useEffect(() => () => stopAudioPreview(), []);

  /** Select word `i` (Shift extends from the last clicked word) as the clip's marked range. */
  const pickWord = useCallback(
    (i: number, extend: boolean) => {
      if (!item) return;
      const from = extend && wordAnchorIndex != null ? wordAnchorIndex : i;
      const cut = wordRangeCut(item, from, i);
      if (!extend) setWordAnchorIndex(i);
      setRange(cut ? { clipId: item.id, ...cut } : null);
    },
    [item, wordAnchorIndex, setRange],
  );

  /** Play clip-local [start, end) of this clip (its file slice and gain). */
  const playRange = useCallback(
    (start: number, end: number, tag: 'clip' | number) => {
      if (!item) return;
      if (previewing === tag) {
        stopAudioPreview();
        return;
      }
      setPreviewing(tag);
      void playAudioPreview(
        item.audioUrl,
        clipSourceIn(item) + Math.max(0, start),
        Math.max(0.01, end - start),
        dbToGain(item.gainDb ?? 0),
        () => setPreviewing((p) => (p === tag ? null : p)),
      );
    },
    [item, previewing],
  );

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

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => playRange(0, item.duration, 'clip')}
            className="rounded-ctl border border-highlight/60 bg-raised px-3 py-1.5 text-ctl text-chalk hover:bg-rule"
          >
            {previewing === 'clip' ? 'Stop' : 'Play clip'}
          </button>
          <span className="text-meta text-chalk-faint tabular-nums">
            {item.duration.toFixed(2)} s
            {isEditedClip(item)
              ? ` · plays ${clipSourceIn(item).toFixed(2)}–${(clipSourceIn(item) + item.duration).toFixed(2)} s of ${clipFileLength(item).toFixed(2)} s file`
              : ''}
          </span>
        </div>

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

        {boundaries.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-chalk-dim font-medium text-meta ">Transcript</h3>
            <div className="flex flex-wrap gap-1 rounded-ctl border border-rule bg-ink/60 p-1.5" dir="auto">
              {boundaries.map((b, i) => {
                const mid = (b.start + b.end) / 2;
                const picked = range != null && mid >= range.from && mid < range.to;
                return (
                  <button
                    key={`${b.word}-${i}`}
                    type="button"
                    dir="auto"
                    onClick={(e) => pickWord(i, e.shiftKey)}
                    className={`rounded-ctl px-1 py-0.5 text-meta ${
                      picked ? 'bg-highlight text-highlight-ink' : 'text-chalk hover:bg-rule'
                    }`}
                  >
                    {b.word}
                  </button>
                );
              })}
            </div>
            {range ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => playRange(range.from, range.to, 'clip')}
                  className="rounded-ctl border border-highlight/60 bg-raised px-2 py-1 text-ctl text-chalk hover:bg-rule"
                >
                  {previewing === 'clip' ? 'Stop' : 'Play selection'}
                </button>
                <button
                  type="button"
                  onClick={() => deleteAudioSelection()}
                  className="rounded-ctl border border-rule bg-ink/95 px-2 py-1 text-ctl text-chalk hover:bg-rule"
                >
                  Delete words
                </button>
                <button
                  type="button"
                  onClick={() => cutAudioSelection()}
                  className="rounded-ctl border border-rule bg-ink/95 px-2 py-1 text-ctl text-chalk hover:bg-rule"
                >
                  Cut
                </button>
                <button
                  type="button"
                  onClick={() => copyAudioSelection()}
                  className="rounded-ctl border border-rule bg-ink/95 px-2 py-1 text-ctl text-chalk hover:bg-rule"
                >
                  Copy
                </button>
              </div>
            ) : null}
            <p className="text-meta text-chalk-faint">
              Click a word, Shift+click to extend. Cuts fall in the middle of the pauses around the
              words. Deleting closes the gap (the rest becomes a second clip); later narration and
              clips anchored to later words move up. Paste with Ctrl+V on the timeline.
            </p>
          </section>
        ) : null}

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
                      onClick={() => playRange(boundary.start, boundary.end, index)}
                      className="rounded-ctl border border-highlight/60 bg-raised px-1 py-0.5 text-meta text-kind-graph hover:bg-rule"
                    >
                      {previewing === index ? 'Stop' : 'Play'}
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
            Edit
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!playheadInside}
              onClick={() => splitAudioAt(playheadTime)}
              title="Cut this clip in two at the playhead (S on the timeline)"
              className="rounded-ctl border border-rule bg-ink/95 px-3 py-1.5 text-ctl text-chalk hover:bg-rule disabled:opacity-40"
            >
              Split at playhead
            </button>
            <button
              type="button"
              disabled={!range}
              onClick={() => deleteAudioSelection()}
              title="Remove the marked range; the rest of the clip and later narration close up"
              className="rounded-ctl border border-rule bg-ink/95 px-3 py-1.5 text-ctl text-chalk hover:bg-rule disabled:opacity-40"
            >
              {range
                ? `Delete ${(range.to - range.from).toFixed(2)} s range`
                : 'Delete marked range'}
            </button>
            <label className="flex items-center gap-1">
              <span className="text-chalk-faint">Gain dB</span>
              <input
                type="number"
                min={-40}
                max={20}
                step={0.5}
                value={item.gainDb ?? 0}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setAudioClipGain(item.id, Number.isFinite(v) ? v : undefined);
                }}
                className="w-16 rounded-ctl border border-rule bg-ink px-2 py-1 text-chalk"
              />
            </label>
          </div>
          <p className="text-meta text-chalk-faint">
            Alt+drag on the clip marks a range. Pieces keep the cut fades below, so joins don&apos;t
            click. Edits never change the audio file.
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
            Empty fields use scene default ({effectiveFadeIn} ms). Heard in the timeline preview and
            applied at export.
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
