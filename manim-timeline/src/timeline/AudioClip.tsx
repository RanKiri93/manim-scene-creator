import { useRef, useCallback, useMemo } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { usePreviewMergedItems } from '@/agent/previewSelectors';
import { boundaryTimeToSeconds, type AudioTrackItem } from '@/types/scene';
import { collectAudioBoundaryTimes, snapToNearestBoundary } from './timelineSnap';
import { isMultiSelectModifier } from '@/lib/uiModifiers';
import { explicitVisualOwnerForAudioTrack } from '@/lib/audioBinding';
import { itemClipDisplayName } from '@/lib/itemDisplayName';
import BoundaryLabel, { isMathBoundaryWord } from './BoundaryLabel';
import Waveform from './Waveform';
import { useAudioEditSession } from './audioEditSession';

/** Height of the narration lane (px); the waveform fills it. */
export const AUDIO_LANE_PX = 56;

interface AudioClipProps {
  item: AudioTrackItem;
  pxPerSecond: number;
  viewStart: number;
  stackIndex: number;
  isSelected: boolean;
  onEditRequest: (id: string) => void;
}

export default function AudioClip({
  item,
  pxPerSecond,
  viewStart,
  stackIndex,
  isSelected,
  onEditRequest,
}: AudioClipProps) {
  const select = useSceneStore((s) => s.select);
  const moveAudioItem = useSceneStore((s) => s.moveAudioItem);
  const setAudioItemStartTimes = useSceneStore((s) => s.setAudioItemStartTimes);
  const removeAudioItem = useSceneStore((s) => s.removeAudioItem);
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
    const parts = [
      primary,
      'Double-click to edit audio. Drag an edge to trim. Alt+drag marks a range.',
      'S splits at the playhead. Delete removes the range (the clip closes up) or the clip.',
      'Ctrl+C / Ctrl+X copy or cut; Ctrl+V pastes on top at the playhead, Ctrl+Shift+V inserts and pushes later audio.',
    ];
    if (owner) {
      parts.push(
        [
          `Linked to: ${itemClipDisplayName(owner)}`,
          `This audio clip's timeline start follows "${itemClipDisplayName(owner)}". Move that clip or unbind to reposition audio.`,
        ].join('\n'),
      );
    }
    return parts.join('\n');
  }, [item.text, item.id, owner]);

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

  const range = useAudioEditSession((st) => (st.range?.clipId === item.id ? st.range : null));
  const setRange = useAudioEditSession((st) => st.setRange);
  const trimAudioClip = useSceneStore((s) => s.trimAudioClip);
  const commitAudioDrag = useSceneStore((s) => s.commitAudioDrag);

  /** Alt+drag: mark a range inside this clip (clip-local seconds). */
  const startRangeDrag = useCallback(
    (e: React.MouseEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const toLocal = (clientX: number) =>
        Math.min(item.duration, Math.max(0, (clientX - rect.left) / pxPerSecond));
      const anchor = toLocal(e.clientX);
      setRange({ clipId: item.id, from: anchor, to: anchor });
      const onMove = (ev: MouseEvent) => {
        const t = toLocal(ev.clientX);
        setRange({ clipId: item.id, from: Math.min(anchor, t), to: Math.max(anchor, t) });
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        const r = useAudioEditSession.getState().range;
        if (r && r.to - r.from < 0.02) setRange(null);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [item.id, item.duration, pxPerSecond, setRange],
  );

  /** Drag a clip edge: one undo step for the whole drag. */
  const onMouseDownTrim = useCallback(
    (edge: 'start' | 'end') => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      select(item.id, false);
      setRange(null);
      const state = useSceneStore.getState();
      const base = state.audioItems.find((a) => a.id === item.id);
      if (!base) return;
      const before = state.audioItems;
      const edgeT0 = edge === 'start' ? base.startTime : base.startTime + base.duration;
      const startX = e.clientX;
      useSceneStore.temporal.getState().pause();
      const onMove = (ev: MouseEvent) => {
        trimAudioClip(item.id, edge, edgeT0 + (ev.clientX - startX) / pxPerSecond, base);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        commitAudioDrag(before);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [item.id, pxPerSecond, select, setRange, trimAudioClip, commitAudioDrag],
  );

  const onMouseDownMove = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (e.altKey) {
        select(item.id, false);
        startRangeDrag(e);
        return;
      }
      if (useAudioEditSession.getState().range) setRange(null);
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
      startRangeDrag,
      setRange,
    ],
  );

  const zBase = 10 + Math.min(stackIndex, 200);
  const zIndex = isSelected ? zBase + 500 : zBase;

  return (
    <div
      className={`absolute top-0 bottom-0 ${owner ? 'cursor-not-allowed' : 'cursor-grab'} select-none overflow-visible rounded-ctl border border-ink/25 bg-kind-audio text-highlight-ink ${
        owner ? '' : 'active:cursor-grabbing'
      } ${
        isSelected ? 'ring-2 ring-highlight ring-offset-1 ring-offset-panel' : ''
      }`}
      style={{ left: `${left}px`, width: `${width}px`, zIndex }}
      title={clipTitle}
      onMouseDown={onMouseDownMove}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onEditRequest(item.id);
      }}
    >
      <Waveform
        url={item.audioUrl}
        fromSec={item.sourceIn ?? 0}
        toSec={(item.sourceIn ?? 0) + item.duration}
        widthPx={width}
        heightPx={AUDIO_LANE_PX - 2}
        className="pointer-events-none absolute left-0 top-0 z-0 text-ink/35"
      />
      {range ? (
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 bottom-0 z-10 border-x-2 border-highlight bg-highlight/35"
          style={{ left: `${range.from * pxPerSecond}px`, width: `${Math.max(2, (range.to - range.from) * pxPerSecond)}px` }}
        />
      ) : null}
      {owner ? null : (
        <div
          className="absolute top-0 bottom-0 left-0 z-30 w-1.5 cursor-ew-resize hover:bg-ink/30"
          title="Drag to trim the start"
          onMouseDown={onMouseDownTrim('start')}
        />
      )}
      <div
        className="absolute top-0 bottom-0 right-0 z-30 w-1.5 cursor-ew-resize hover:bg-ink/30"
        title="Drag to trim the end"
        onMouseDown={onMouseDownTrim('end')}
      />
      <button
        type="button"
        className="absolute top-0.5 right-0.5 z-40 flex size-4 shrink-0 items-center justify-center rounded-ctl bg-ink/75 text-chalk-dim transition-colors hover:bg-danger hover:text-highlight-ink"
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
        <span className="text-meta leading-none font-bold" aria-hidden>
          ×
        </span>
      </button>
      {isSelected ? (
        <button
          type="button"
          className="absolute top-0.5 right-5 z-40 flex h-4 items-center justify-center rounded-ctl bg-ink/75 px-1 text-meta leading-none text-chalk transition-colors hover:bg-ink"
          title="Edit audio (processing, timing, fades)"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onEditRequest(item.id);
          }}
        >
          Edit
        </button>
      ) : null}
      {boundaries.length === 0 || owner ? (
        <span className="pointer-events-none absolute left-0.5 top-0 z-30 flex max-w-[min(200px,calc(100%-20px))] min-w-0 items-center gap-0.5">
          {boundaries.length === 0 ? (
            <span className="min-w-0 truncate text-meta leading-tight font-medium" dir="auto">
              {item.text.trim() ? item.text : '·'}
            </span>
          ) : null}
          {owner ? (
            <span
              title={clipTitle}
              className="shrink-0 rounded-ctl bg-ink/70 px-1 text-meta leading-4 text-warn"
            >
              Linked
            </span>
          ) : null}
        </span>
      ) : null}
      {(() => {
        const tickLefts = boundaries.map((boundary, i) => {
          const raw = rawList[i];
          const startRaw = raw?.start ?? boundary.start;
          let tickLeft = startRaw * pxPerSecond;
          if (tickLeft > width + 2) {
            tickLeft = (startRaw / 1000) * pxPerSecond;
          }
          return Math.max(0, Math.min(tickLeft, width - 2));
        });
        return boundaries.map((boundary, i) => {
          const tickLeft = tickLefts[i];
          const prevLeft = i > 0 ? tickLefts[i - 1] : 0;
          const nextLeft = i + 1 < tickLefts.length ? tickLefts[i + 1] : width;
          const nearRight = tickLeft > width - 100;
          const segmentEnd = nearRight ? tickLeft : nextLeft;
          const segmentStart = nearRight ? prevLeft : tickLeft;
          const segmentWidth = Math.max(12, segmentEnd - segmentStart - 4);
          const isMath = isMathBoundaryWord(boundary.word);
          const labelMax = isMath
            ? segmentWidth
            : Math.max(12, Math.min(segmentEnd - tickLeft - 4, 200));
          return (
            <div
              key={`${boundary.start}-${i}`}
              className="pointer-events-none absolute top-0 bottom-0 z-20"
              style={{ left: `${tickLeft}px`, width: 0 }}
            >
              <div
                className="absolute top-0 bg-ink/45"
                style={{ left: 0, width: '2px', height: '100%', zIndex: 20 }}
                aria-hidden
              />
              <div
                className="absolute top-0.5"
                style={
                  isMath
                    ? { left: '4px', width: `${labelMax}px` }
                    : nearRight
                      ? { right: 0 }
                      : { left: '4px' }
                }
              >
                <BoundaryLabel
                  word={boundary.word}
                  align={nearRight ? 'right' : 'left'}
                  maxWidthPx={labelMax}
                  fillSegment={isMath}
                />
              </div>
            </div>
          );
        });
      })()}
    </div>
  );
}
