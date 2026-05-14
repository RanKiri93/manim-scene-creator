import { useRef, useCallback, useMemo, useState } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { usePreviewMergedItems } from '@/agent/previewSelectors';
import { boundaryTimeToSeconds, type AudioTrackItem } from '@/types/scene';
import { collectAudioBoundaryTimes, snapToNearestBoundary } from './timelineSnap';
import { isMultiSelectModifier } from '@/lib/uiModifiers';
import { explicitVisualOwnerForAudioTrack } from '@/lib/audioBinding';
import { itemClipDisplayName } from '@/lib/itemDisplayName';
import {
  AUDIO_GAP_PRESETS,
  findPreviousAudioEndingBefore,
} from '@/lib/audioGapPresets';

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
  const normalizeAudioTrack = useSceneStore((s) => s.normalizeAudioTrack);
  const placeAudioAfterPrevious = useSceneStore((s) => s.placeAudioAfterPrevious);
  const spaceSelectedAudioItems = useSceneStore((s) => s.spaceSelectedAudioItems);
  const measureEnabled = useSceneStore((s) => s.measureConfig.enabled);
  const selectedIds = useSceneStore((s) => s.selectedIds);
  const audioItems = useSceneStore((s) => s.audioItems);
  const itemsMap = usePreviewMergedItems();

  const owner = useMemo(
    () => explicitVisualOwnerForAudioTrack(itemsMap, item.id),
    [itemsMap, item.id],
  );

  const clipTitle = useMemo(() => {
    const primary = item.text.trim()
      ? item.text
      : `Audio (${item.id.slice(0, 8)}...)`;
    const parts = [primary];
    if (owner) {
      parts.push(
        [
          `Linked to: ${itemClipDisplayName(owner)}`,
          `This audio clip’s timeline start follows “${itemClipDisplayName(owner)}”. Move that clip or unbind to reposition audio.`,
        ].join('\n'),
      );
    }
    return parts.join('\n');
  }, [item.text, item.id, owner, item.audioProcessing?.normalized]);

  const dragRef = useRef<{
    startX: number;
    primaryBaseline: number;
    baselines: Record<string, number>;
  } | null>(null);
  const lastSnappedStartRef = useRef<number | null>(null);

  const [normBusy, setNormBusy] = useState(false);
  const [normErr, setNormErr] = useState<string | null>(null);

  const onNormalizeClick = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setNormErr(null);
      setNormBusy(true);
      try {
        await normalizeAudioTrack(item.id);
      } catch (err) {
        setNormErr(err instanceof Error ? err.message : String(err));
      } finally {
        setNormBusy(false);
      }
    },
    [normalizeAudioTrack, item.id],
  );

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
    () => findPreviousAudioEndingBefore(audioItems, item.id) != null,
    [audioItems, item.id],
  );

  const gapPresetsDisabled =
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

  const onGapPresetClick = useCallback(
    (gapSec: number) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (owner) return;
      if (selectedAudioCount >= 2) {
        spaceSelectedAudioItems(gapSec);
      } else {
        placeAudioAfterPrevious(item.id, gapSec);
      }
    },
    [
      owner,
      selectedAudioCount,
      spaceSelectedAudioItems,
      placeAudioAfterPrevious,
      item.id,
    ],
  );

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
      select(item.id, isMultiSelectModifier(e));
      if (owner) return;
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
      owner,
      pxPerSecond,
      moveAudioItem,
      setAudioItemStartTimes,
      select,
      audioItems,
    ],
  );

  const zBase = 10 + Math.min(stackIndex, 200);
  const zIndex = isSelected ? zBase + 500 : zBase;

  return (
    <div
      className={`absolute top-0 bottom-0 ${owner ? 'cursor-not-allowed' : 'cursor-grab'} select-none overflow-visible rounded-sm border border-slate-500/60 bg-slate-700/50 ${
        owner ? '' : 'active:cursor-grabbing'
      } ${
        isSelected ? 'ring-2 ring-blue-300 ring-offset-1 ring-offset-slate-800' : ''
      }`}
      style={{ left: `${left}px`, width: `${width}px`, zIndex }}
      title={clipTitle}
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
      <span className="pointer-events-none absolute left-0.5 top-0 z-30 flex max-w-[min(200px,calc(100%-20px))] min-w-0 items-center gap-0.5">
        <span className="min-w-0 truncate text-[9px] font-medium leading-tight text-slate-200 drop-shadow-sm">
          {item.text.trim() ? item.text : '·'}
        </span>
        {owner ? (
          <span
            title={clipTitle}
            className="shrink-0 rounded border border-amber-400/55 bg-amber-500/20 px-1 text-[9px] font-medium leading-none text-amber-100"
          >
            Linked
          </span>
        ) : null}
        {item.audioProcessing?.normalized ? (
          <span
            title={`Normalized to ${item.audioProcessing.normalized.targetLufs} LUFS (integrated)`}
            className="shrink-0 rounded border border-emerald-500/55 bg-emerald-600/20 px-1 text-[9px] font-medium leading-none text-emerald-100"
          >
            {`${item.audioProcessing.normalized.targetLufs} LUFS`}
          </span>
        ) : null}
      </span>
      {isSelected ? (
        <div className="pointer-events-auto absolute bottom-0.5 left-0.5 right-6 z-40 flex max-w-[calc(100%-8px)] flex-col items-start gap-1">
          {!owner ? (
            <div className="flex flex-wrap gap-0.5" aria-label="Gap presets">
              {AUDIO_GAP_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={gapPresetsDisabled}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={onGapPresetClick(p.seconds)}
                  className="min-w-[1.25rem] rounded border border-slate-500/70 bg-slate-900/95 px-1 py-0.5 text-[8px] font-semibold leading-none text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                  title={gapPresetTitle(p)}
                >
                  {p.shortLabel}
                </button>
              ))}
            </div>
          ) : null}
          {normErr ? (
            <span
              className="max-w-full truncate rounded bg-red-950/70 px-1 text-[8px] text-red-200"
              title={normErr}
            >
              {normErr}
            </span>
          ) : null}
          <button
            type="button"
            disabled={normBusy || !measureEnabled}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => void onNormalizeClick(e)}
            className="rounded border border-slate-500/80 bg-slate-900/95 px-1.5 py-0.5 text-[8px] font-medium text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            title={
              measureEnabled
                ? 'Normalize loudness (EBU R128) via measure server'
                : 'Turn on the measure server in settings'
            }
          >
            {normBusy ? 'Normalizing…' : 'Normalize'}
          </button>
        </div>
      ) : null}
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
