import { useRef, useCallback, type ReactNode } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type {
  GraphFunctionSeriesItem,
  SceneItem,
  TextLineItem,
} from '@/types/scene';
import {
  functionSeriesChildStartOffset,
  functionSeriesHasErrors,
  functionSeriesIndices,
  resolveFunctionSeriesN,
} from '@/types/scene';
import {
  applyWaitBodyShift,
  isTopLevelItem,
  runDuration,
  segmentWaitTotal,
  textLineAnimOnlyDuration,
} from '@/lib/time';
import { itemClipDisplayName } from '@/lib/itemDisplayName';
import { isMultiSelectModifier } from '@/lib/uiModifiers';
import { collectAudioBoundaryTimes, snapToNearestBoundary } from './timelineSnap';
import {
  applyWaitEdgeResize,
  getSegmentAnimSec,
  shiftAnimBoundaryFromBaseline,
} from '@/lib/segmentAnimDurations';

interface TimelineClipProps {
  item: SceneItem;
  /** Order within the layer (later clips stack above earlier for easier overlap clicks). */
  stackIndex: number;
  pxPerSecond: number;
  viewStart: number;
  isSelected: boolean;
}

const KIND_COLORS: Record<string, string> = {
  textLine: 'bg-blue-600/80 border-blue-400',
  axes: 'bg-emerald-600/80 border-emerald-400',
  graphPlot: 'bg-teal-600/80 border-teal-400',
  graphDot: 'bg-cyan-600/80 border-cyan-400',
  graphField: 'bg-lime-700/80 border-lime-400',
  graphFunctionSeries: 'bg-fuchsia-700/80 border-fuchsia-400',
  graphArea: 'bg-violet-700/80 border-violet-400',
  exit_animation: 'bg-rose-700/85 border-rose-400',
  surroundingRect: 'bg-orange-700/85 border-orange-300',
  shape: 'bg-pink-700/85 border-pink-300',
};

export default function TimelineClip({
  item,
  stackIndex,
  pxPerSecond,
  viewStart,
  isSelected,
}: TimelineClipProps) {
  const select = useSceneStore((s) => s.select);
  const moveItem = useSceneStore((s) => s.moveItem);
  const setSceneItemStartTimes = useSceneStore((s) => s.setSceneItemStartTimes);
  const resizeItem = useSceneStore((s) => s.resizeItem);
  const updateItem = useSceneStore((s) => s.updateItem);
  const setCurrentTime = useSceneStore((s) => s.setCurrentTime);
  const audioItems = useSceneStore((s) => s.audioItems);
  const itemsMap = useSceneStore((s) => s.items);

  const dragRef = useRef<{
    startX: number;
    primaryBaseline: number;
    baselines: Record<string, number>;
  } | null>(null);
  const lastSnappedStartRef = useRef<number | null>(null);
  const resizeRef = useRef<{ startX: number; startDuration: number } | null>(null);
  const waitResizeRef = useRef<{
    segmentIndex: number;
    edge: 'left' | 'right';
    startX: number;
    startWait: number;
    baselineSegments: TextLineItem['segments'];
    baselineAnim: number[];
    baselineW: number[];
  } | null>(null);
  const waitMoveRef = useRef<{
    segmentIndex: number;
    startX: number;
    segments: TextLineItem['segments'];
    duration: number;
  } | null>(null);
  const animBoundaryRef = useRef<{
    leftIndex: number;
    startX: number;
    baselineAnim: number[];
    segments: TextLineItem['segments'];
    duration: number;
  } | null>(null);

  const left = (item.startTime - viewStart) * pxPerSecond;
  const barDuration = runDuration(item, itemsMap);
  const width = Math.max(barDuration * pxPerSecond, 16);

  const label = (() => {
    const s = itemClipDisplayName(item);
    if (item.kind === 'exit_animation') {
      return s.length > 22 ? `${s.slice(0, 22)}…` : s;
    }
    return s.length > 28 ? `${s.slice(0, 28)}…` : s;
  })();

  const colors = KIND_COLORS[item.kind] ?? 'bg-slate-600/80 border-slate-400';

  const onMouseDownMove = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      select(item.id, isMultiSelectModifier(e));
      const state = useSceneStore.getState();
      const baselines: Record<string, number> = {};
      for (const id of state.selectedIds) {
        const it = state.items.get(id);
        if (it && isTopLevelItem(it)) baselines[id] = it.startTime;
      }
      baselines[item.id] = state.items.get(item.id)?.startTime ?? item.startTime;
      dragRef.current = {
        startX: e.clientX,
        primaryBaseline: baselines[item.id]!,
        baselines,
      };
      lastSnappedStartRef.current = baselines[item.id]!;
      const boundaryTimes = collectAudioBoundaryTimes(audioItems);

      const applyDelta = (primarySnapped: number) => {
        const d = dragRef.current;
        if (!d) return;
        const delta = primarySnapped - d.primaryBaseline;
        const ids = Object.keys(d.baselines);
        if (ids.length <= 1) {
          moveItem(item.id, primarySnapped);
          return;
        }
        setSceneItemStartTimes(
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
            moveItem(item.id, finalStart);
          } else {
            setSceneItemStartTimes(
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
      moveItem,
      setSceneItemStartTimes,
      select,
      audioItems,
    ],
  );

  const onMouseDownResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = {
        startX: e.clientX,
        startDuration: runDuration(item, itemsMap),
      };

      const onMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return;
        const dx = ev.clientX - resizeRef.current.startX;
        const dt = dx / pxPerSecond;
        const newVisual = Math.max(0.05, resizeRef.current.startDuration + dt);
        resizeItem(item.id, newVisual);
      };
      const onUp = () => {
        resizeRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [item.id, item, itemsMap, pxPerSecond, resizeItem],
  );

  const onMouseDownWaitResize = useCallback(
    (e: React.MouseEvent, segmentIndex: number, edge: 'left' | 'right') => {
      e.preventDefault();
      e.stopPropagation();
      if (item.kind !== 'textLine') return;
      select(item.id, isMultiSelectModifier(e));
      const tl = item as TextLineItem;
      const animOnly = textLineAnimOnlyDuration(tl, itemsMap);
      const startWait = Math.max(0, tl.segments[segmentIndex]?.waitAfterSec ?? 0);
      waitResizeRef.current = {
        segmentIndex,
        edge,
        startX: e.clientX,
        startWait,
        baselineSegments: tl.segments.map((s) => ({ ...s })),
        baselineAnim: getSegmentAnimSec(tl.segments, animOnly),
        baselineW: tl.segments.map((s) => Math.max(0, s.waitAfterSec ?? 0)),
      };

      const onMove = (ev: MouseEvent) => {
        const d = waitResizeRef.current;
        if (!d) return;
        const dt = (ev.clientX - d.startX) / pxPerSecond;
        const targetWait =
          d.edge === 'right' ? d.startWait + dt : d.startWait - dt;
        const { segments, duration } = applyWaitEdgeResize(
          d.segmentIndex,
          d.edge,
          targetWait,
          d.baselineSegments,
          d.baselineAnim,
          d.baselineW,
        );
        updateItem(item.id, { segments, duration });
      };
      const onUp = () => {
        waitResizeRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [item, select, updateItem, pxPerSecond, itemsMap],
  );

  const onMouseDownWaitMove = useCallback(
    (e: React.MouseEvent, segmentIndex: number) => {
      e.preventDefault();
      e.stopPropagation();
      if (item.kind !== 'textLine') return;
      select(item.id, isMultiSelectModifier(e));
      const tl = item as TextLineItem;
      waitMoveRef.current = {
        segmentIndex,
        startX: e.clientX,
        segments: tl.segments.map((s) => ({ ...s })),
        duration: tl.duration,
      };

      const onMove = (ev: MouseEvent) => {
        const d = waitMoveRef.current;
        if (!d) return;
        const shift = (ev.clientX - d.startX) / pxPerSecond;
        const { segments, duration } = applyWaitBodyShift(
          d.segmentIndex,
          shift,
          d.segments,
          d.duration,
        );
        updateItem(item.id, { segments, duration });
      };
      const onUp = () => {
        waitMoveRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [item, select, updateItem, pxPerSecond],
  );

  const onMouseDownAnimBoundary = useCallback(
    (e: React.MouseEvent, leftIndex: number) => {
      e.preventDefault();
      e.stopPropagation();
      if (item.kind !== 'textLine') return;
      select(item.id, isMultiSelectModifier(e));
      const tl = item as TextLineItem;
      const animOnly = textLineAnimOnlyDuration(tl, itemsMap);
      animBoundaryRef.current = {
        leftIndex,
        startX: e.clientX,
        baselineAnim: getSegmentAnimSec(tl.segments, animOnly),
        segments: tl.segments.map((s) => ({ ...s })),
        duration: tl.duration,
      };

      const onMove = (ev: MouseEvent) => {
        const d = animBoundaryRef.current;
        if (!d) return;
        const dt = (ev.clientX - d.startX) / pxPerSecond;
        const nextSegs = shiftAnimBoundaryFromBaseline(
          d.segments,
          d.duration,
          d.leftIndex,
          dt,
          d.baselineAnim,
        );
        updateItem(item.id, { segments: nextSegs });
      };
      const onUp = () => {
        animBoundaryRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [item, select, updateItem, pxPerSecond, itemsMap],
  );

  const onMouseDownFsWait = useCallback(
    (e: React.MouseEvent, n: number) => {
      e.preventDefault();
      e.stopPropagation();
      if (item.kind !== 'graphFunctionSeries') return;
      select(item.id, isMultiSelectModifier(e));
      const fs = item as GraphFunctionSeriesItem;
      const startWait = Math.max(0, resolveFunctionSeriesN(fs, n).waitAfter);
      const startX = e.clientX;
      const onMove = (ev: MouseEvent) => {
        const dt = (ev.clientX - startX) / pxPerSecond;
        const next = Math.max(0, startWait + dt);
        const key = String(n);
        const existing = fs.perN[key] ?? {};
        updateItem(item.id, {
          perN: { ...fs.perN, [key]: { ...existing, waitAfter: next } },
        });
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [item, select, updateItem, pxPerSecond],
  );

  const onMouseDownFsAnim = useCallback(
    (e: React.MouseEvent, n: number) => {
      e.preventDefault();
      e.stopPropagation();
      if (item.kind !== 'graphFunctionSeries') return;
      select(item.id, isMultiSelectModifier(e));
      const fs = item as GraphFunctionSeriesItem;
      const startAnim = Math.max(
        0.01,
        resolveFunctionSeriesN(fs, n).animDuration,
      );
      const startX = e.clientX;
      const onMove = (ev: MouseEvent) => {
        const dt = (ev.clientX - startX) / pxPerSecond;
        const next = Math.max(0.01, startAnim + dt);
        const key = String(n);
        const existing = fs.perN[key] ?? {};
        updateItem(item.id, {
          perN: { ...fs.perN, [key]: { ...existing, animDuration: next } },
        });
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [item, select, updateItem, pxPerSecond],
  );

  const onClickFsBookmark = useCallback(
    (e: React.MouseEvent, n: number) => {
      e.preventDefault();
      e.stopPropagation();
      if (item.kind !== 'graphFunctionSeries') return;
      select(item.id, isMultiSelectModifier(e));
      const fs = item as GraphFunctionSeriesItem;
      const offset = functionSeriesChildStartOffset(fs, n);
      setCurrentTime(item.startTime + offset);
    },
    [item, select, setCurrentTime],
  );

  const functionSeriesStripes =
    item.kind === 'graphFunctionSeries'
      ? (() => {
          const fs = item as GraphFunctionSeriesItem;
          const indices = functionSeriesIndices(fs);
          const totalSec = runDuration(fs, itemsMap);
          if (indices.length === 0 || totalSec <= 1e-9) return null;
          const hasErr = functionSeriesHasErrors(fs);
          const lastN = indices[indices.length - 1]!;
          return (
            <div className="absolute inset-0 flex flex-row z-0" aria-hidden>
              {indices.map((n) => {
                const res = resolveFunctionSeriesN(fs, n);
                const animW = ((res.animDuration ?? 0) / totalSec) * 100;
                const waitW =
                  n === lastN ? 0 : ((res.waitAfter ?? 0) / totalSec) * 100;
                const err = fs.perNErrors?.[String(n)];
                return (
                  <div
                    key={`fs-row-${n}`}
                    className="flex h-full shrink-0"
                    style={{ width: `${animW + waitW}%` }}
                  >
                    <div
                      className={`relative flex h-full shrink-0 min-w-[2px] ${
                        err ? 'bg-red-400/60' : 'bg-white/12'
                      }`}
                      style={{
                        width: `${
                          animW + waitW > 0
                            ? (animW / (animW + waitW)) * 100
                            : 100
                        }%`,
                      }}
                      title={`n=${n} (Create ${res.animDuration.toFixed(2)}s)${
                        err ? ` — error: ${err}` : ''
                      }`}
                    >
                      <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-fuchsia-200/80 pointer-events-auto cursor-pointer"
                        onClick={(ev) => onClickFsBookmark(ev, n)}
                        title={`Jump to n=${n} start`}
                      />
                      <div className="flex-1" />
                      <div
                        className="relative z-[5] w-2 shrink-0 cursor-ew-resize hover:bg-white/30 rounded-sm pointer-events-auto"
                        onMouseDown={(ev) => onMouseDownFsAnim(ev, n)}
                        title={`Drag to resize Create duration for n=${n}`}
                      />
                    </div>
                    {n !== lastN && (
                      <div
                        className="relative flex h-full shrink-0 min-w-[6px] pointer-events-auto"
                        style={{
                          width: `${
                            animW + waitW > 0
                              ? (waitW / (animW + waitW)) * 100
                              : 0
                          }%`,
                        }}
                        title={`Wait ${res.waitAfter.toFixed(2)}s before n=${n + 1}`}
                      >
                        <div className="absolute inset-0 bg-amber-400/40 border-l border-amber-200/30 pointer-events-none" />
                        <div
                          className="relative z-[5] flex-1 cursor-ew-resize hover:bg-white/20"
                          onMouseDown={(ev) => onMouseDownFsWait(ev, n)}
                          title="Drag to resize wait (ripples subsequent curves)"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              {hasErr && (
                <div className="absolute inset-0 bg-red-900/30 border-2 border-red-400/80 pointer-events-none rounded" />
              )}
            </div>
          );
        })()
      : null;

  const zBase = 10 + Math.min(stackIndex, 200);
  const zIndex = isSelected ? zBase + 500 : zBase;

  const borderRing = isSelected
    ? 'ring-2 ring-blue-300 ring-offset-1 ring-offset-slate-900'
    : '';

  const segmentWaitStripes =
    item.kind === 'textLine' && segmentWaitTotal(item.segments) > 0 ? (
      (() => {
        const tl = item as TextLineItem;
        const totalSec = runDuration(tl, itemsMap);
        const animOnly = textLineAnimOnlyDuration(tl, itemsMap);
        const n = Math.max(1, tl.segments.length);
        const animSecs = getSegmentAnimSec(tl.segments, animOnly);
        if (totalSec <= 1e-9) return null;
        return (
          <div className="absolute inset-0 flex flex-row z-0" aria-hidden>
            {tl.segments.flatMap((seg, i) => {
              // Chronological bar: anim[i] → wait[i] → (boundary i|i+1) → anim[i+1] → …
              // The anim–wait boundary must touch so the wait’s left handle visibly shortens segment i.
              const cells: ReactNode[] = [
                <div
                  key={`a-${i}`}
                  className="h-full shrink-0 bg-white/12 min-w-[2px] pointer-events-none"
                  style={{
                    width: `${((animSecs[i] ?? 0) / totalSec) * 100}%`,
                  }}
                />,
              ];
              if ((seg.waitAfterSec ?? 0) > 0) {
                cells.push(
                  <div
                    key={`w-${i}`}
                    className="relative flex h-full shrink-0 flex-row min-w-[28px] pointer-events-auto"
                    style={{
                      width: `${((seg.waitAfterSec ?? 0) / totalSec) * 100}%`,
                    }}
                    title={`Wait ${seg.waitAfterSec}s after segment ${i} — center: slide; left/right: scale vs adjacent animation`}
                  >
                    <div className="absolute inset-0 bg-amber-400/40 border-l border-amber-200/30 pointer-events-none" />
                    <div
                      className="relative z-[5] w-2.5 shrink-0 cursor-ew-resize hover:bg-white/30 rounded-sm"
                      onMouseDown={(ev) => onMouseDownWaitResize(ev, i, 'left')}
                      title="Grow/shrink wait vs segment before (shortens or lengthens its animation)"
                    />
                    <div
                      className="relative z-[2] min-w-[6px] flex-1 cursor-grab active:cursor-grabbing hover:bg-white/10"
                      onMouseDown={(ev) => onMouseDownWaitMove(ev, i)}
                      title="Slide wait along the line"
                    />
                    <div
                      className="relative z-[5] w-2.5 shrink-0 cursor-ew-resize hover:bg-white/30 rounded-sm"
                      onMouseDown={(ev) => onMouseDownWaitResize(ev, i, 'right')}
                      title="Grow/shrink wait vs segment after"
                    />
                  </div>,
                );
              }
              if (i < n - 1) {
                cells.push(
                  <div
                    key={`b-${i}`}
                    className="h-full shrink-0 w-1 min-w-[4px] max-w-[6px] cursor-col-resize hover:bg-white/35 z-[4]"
                    title="Shift animation time between this segment and the next"
                    onMouseDown={(ev) => onMouseDownAnimBoundary(ev, i)}
                  />,
                );
              }
              return cells;
            })}
          </div>
        );
      })()
    ) : null;

  return (
    <div
      className={`absolute top-1 bottom-1 flex cursor-grab select-none items-center overflow-hidden rounded-md border text-[10px] text-white truncate ${colors} ${borderRing}`}
      style={{ left: `${left}px`, width: `${width}px`, zIndex }}
      onMouseDown={onMouseDownMove}
    >
      {segmentWaitStripes}
      {functionSeriesStripes}
      <span className="px-1.5 truncate pointer-events-none relative z-[1] drop-shadow-sm">
        {label}
      </span>

      {item.kind !== 'graphFunctionSeries' && (
        <div
          className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/20 rounded-r-md z-[2]"
          onMouseDown={onMouseDownResize}
        />
      )}
    </div>
  );
}
