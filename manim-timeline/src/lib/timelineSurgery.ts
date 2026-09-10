/**
 * Pure helpers for timeline time edits ("close empty range" / "insert empty time").
 *
 * Both operations only ever create or remove *empty* time: they refuse to run when
 * any visual clip or narration audio clip overlaps the affected range/point, so no
 * clip is ever split, trimmed, or stretched. Callers apply the returned start-time
 * updates in a single store mutation (one undo step).
 */
import type { AudioTrackItem, ItemId, SceneItem } from '@/types/scene';
import { isTopLevelItem, runDuration } from '@/lib/time';
import { itemClipDisplayName } from '@/lib/itemDisplayName';
import { audioTrackLabel } from '@/lib/audioBinding';

/** Comparison tolerance for timeline alignment (seconds). */
export const TIMELINE_SURGERY_EPS = 1e-6;

/** A clip's occupied window on the timeline, with a human-readable label. */
export interface SurgerySpan {
  id: string;
  start: number;
  end: number;
  label: string;
}

/** A clip that prevents a requested edit because it overlaps the range/point. */
export interface SurgeryBlocker {
  kind: 'item' | 'audio';
  id: string;
  label: string;
  start: number;
  end: number;
}

export interface StartTimeUpdate {
  id: string;
  startTime: number;
}

export interface CloseRangePlan {
  ok: boolean;
  error: string | null;
  /** Seconds removed (`end - start`) when `ok`. */
  delta: number;
  blockers: SurgeryBlocker[];
  itemUpdates: StartTimeUpdate[];
  audioUpdates: StartTimeUpdate[];
}

export interface InsertTimePlan {
  ok: boolean;
  error: string | null;
  blockers: SurgeryBlocker[];
  itemUpdates: StartTimeUpdate[];
  audioUpdates: StartTimeUpdate[];
}

function spansOverlapRange(
  spanStart: number,
  spanEnd: number,
  rangeStart: number,
  rangeEnd: number,
): boolean {
  return (
    spanStart < rangeEnd - TIMELINE_SURGERY_EPS &&
    spanEnd > rangeStart + TIMELINE_SURGERY_EPS
  );
}

function spanCoversPoint(
  spanStart: number,
  spanEnd: number,
  at: number,
): boolean {
  return (
    spanStart < at - TIMELINE_SURGERY_EPS &&
    spanEnd > at + TIMELINE_SURGERY_EPS
  );
}

function sortBlockers(blockers: SurgeryBlocker[]): SurgeryBlocker[] {
  return blockers.sort(
    (a, b) => a.start - b.start || a.id.localeCompare(b.id),
  );
}

/** Validate a close-range request. Returns the removed delta when valid. */
export function validateCloseRange(
  start: number,
  end: number,
): { ok: true; delta: number } | { ok: false; error: string } {
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { ok: false, error: 'Range start and end must be finite numbers.' };
  }
  if (start < 0) {
    return { ok: false, error: 'Range start cannot be negative.' };
  }
  if (!(end > start)) {
    return { ok: false, error: 'Range end must be after range start.' };
  }
  return { ok: true, delta: end - start };
}

/** Validate an insert-empty-time request. */
export function validateInsertTime(
  at: number,
  durationSec: number,
): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(at) || !Number.isFinite(durationSec)) {
    return { ok: false, error: 'Insertion point and duration must be finite numbers.' };
  }
  if (at < 0) {
    return { ok: false, error: 'Insertion point cannot be negative.' };
  }
  if (!(durationSec > 0)) {
    return { ok: false, error: 'Inserted duration must be positive.' };
  }
  return { ok: true };
}

/**
 * Plan closing the empty interval `[start, end)`: every clip starting at or
 * after `end` shifts left by `end - start`. Clips ending exactly at `start`
 * and clips starting exactly at `end` are allowed; anything intersecting the
 * range blocks the edit.
 */
export function planCloseRange(
  itemSpans: readonly SurgerySpan[],
  audioSpans: readonly SurgerySpan[],
  start: number,
  end: number,
): CloseRangePlan {
  const validation = validateCloseRange(start, end);
  if (!validation.ok) {
    return {
      ok: false,
      error: validation.error,
      delta: 0,
      blockers: [],
      itemUpdates: [],
      audioUpdates: [],
    };
  }
  const delta = validation.delta;
  const blockers: SurgeryBlocker[] = [];
  for (const s of itemSpans) {
    if (spansOverlapRange(s.start, s.end, start, end)) {
      blockers.push({ kind: 'item', id: s.id, label: s.label, start: s.start, end: s.end });
    }
  }
  for (const s of audioSpans) {
    if (spansOverlapRange(s.start, s.end, start, end)) {
      blockers.push({ kind: 'audio', id: s.id, label: s.label, start: s.start, end: s.end });
    }
  }
  if (blockers.length > 0) {
    return {
      ok: false,
      error: 'Clips overlap the range — only empty time can be closed.',
      delta,
      blockers: sortBlockers(blockers),
      itemUpdates: [],
      audioUpdates: [],
    };
  }
  const itemUpdates: StartTimeUpdate[] = [];
  for (const s of itemSpans) {
    if (s.start >= end - TIMELINE_SURGERY_EPS) {
      itemUpdates.push({ id: s.id, startTime: Math.max(0, s.start - delta) });
    }
  }
  const audioUpdates: StartTimeUpdate[] = [];
  for (const s of audioSpans) {
    if (s.start >= end - TIMELINE_SURGERY_EPS) {
      audioUpdates.push({ id: s.id, startTime: Math.max(0, s.start - delta) });
    }
  }
  return { ok: true, error: null, delta, blockers: [], itemUpdates, audioUpdates };
}

/**
 * Plan inserting `durationSec` seconds of empty time at `at`: every clip
 * starting at or after `at` shifts right by `durationSec`. Clips ending
 * exactly at `at` and clips starting exactly at `at` are allowed; a clip
 * spanning across `at` blocks the edit.
 */
export function planInsertTime(
  itemSpans: readonly SurgerySpan[],
  audioSpans: readonly SurgerySpan[],
  at: number,
  durationSec: number,
): InsertTimePlan {
  const validation = validateInsertTime(at, durationSec);
  if (!validation.ok) {
    return {
      ok: false,
      error: validation.error,
      blockers: [],
      itemUpdates: [],
      audioUpdates: [],
    };
  }
  const blockers: SurgeryBlocker[] = [];
  for (const s of itemSpans) {
    if (spanCoversPoint(s.start, s.end, at)) {
      blockers.push({ kind: 'item', id: s.id, label: s.label, start: s.start, end: s.end });
    }
  }
  for (const s of audioSpans) {
    if (spanCoversPoint(s.start, s.end, at)) {
      blockers.push({ kind: 'audio', id: s.id, label: s.label, start: s.start, end: s.end });
    }
  }
  if (blockers.length > 0) {
    return {
      ok: false,
      error: 'A clip spans the insertion point — pick empty time to insert into.',
      blockers: sortBlockers(blockers),
      itemUpdates: [],
      audioUpdates: [],
    };
  }
  const itemUpdates: StartTimeUpdate[] = [];
  for (const s of itemSpans) {
    if (s.start >= at - TIMELINE_SURGERY_EPS) {
      itemUpdates.push({ id: s.id, startTime: s.start + durationSec });
    }
  }
  const audioUpdates: StartTimeUpdate[] = [];
  for (const s of audioSpans) {
    if (s.start >= at - TIMELINE_SURGERY_EPS) {
      audioUpdates.push({ id: s.id, startTime: s.start + durationSec });
    }
  }
  return { ok: true, error: null, blockers: [], itemUpdates, audioUpdates };
}

/**
 * Map the playhead through a close-range edit: inside the removed interval it
 * lands on `start`; after `end` it shifts left by the removed delta.
 */
export function mapCloseRangePlayhead(t: number, start: number, end: number): number {
  if (t >= end) return Math.max(0, t - (end - start));
  if (t > start) return start;
  return t;
}

/**
 * Map the playhead through an insert edit: after the insertion point it shifts
 * right by `durationSec`; exactly at the point it stays (the new empty time
 * opens up after it).
 */
export function mapInsertPlayhead(t: number, at: number, durationSec: number): number {
  if (t > at + TIMELINE_SURGERY_EPS) return t + durationSec;
  return t;
}

/**
 * Build timeline spans from live store state. Visual spans use the rendered clip
 * window (`startTime` + `runDuration`, matching `TimelineClip` bars) — not the
 * on-screen presence span, so a line with a far-future exit does not block edits
 * to structurally empty time. Legacy compound children (if any survive migration)
 * are excluded: they never move alone.
 */
export function collectSurgerySpans(
  items: Map<ItemId, SceneItem>,
  audioItems: readonly AudioTrackItem[],
): { itemSpans: SurgerySpan[]; audioSpans: SurgerySpan[] } {
  const itemSpans: SurgerySpan[] = [];
  for (const it of items.values()) {
    if (!isTopLevelItem(it)) continue;
    if ((it as { parentId?: unknown }).parentId != null) continue;
    itemSpans.push({
      id: it.id,
      start: it.startTime,
      end: it.startTime + runDuration(it, items),
      label: itemClipDisplayName(it),
    });
  }
  const audioSpans: SurgerySpan[] = audioItems.map((a) => ({
    id: a.id,
    start: a.startTime,
    end: a.startTime + a.duration,
    label: audioTrackLabel(a),
  }));
  return { itemSpans, audioSpans };
}

/** Earliest clip start strictly after `t` across both span lists, or null. */
export function nextClipStartAfter(
  itemSpans: readonly SurgerySpan[],
  audioSpans: readonly SurgerySpan[],
  t: number,
): number | null {
  let best: number | null = null;
  for (const s of itemSpans) {
    if (s.start > t + TIMELINE_SURGERY_EPS && (best === null || s.start < best)) {
      best = s.start;
    }
  }
  for (const s of audioSpans) {
    if (s.start > t + TIMELINE_SURGERY_EPS && (best === null || s.start < best)) {
      best = s.start;
    }
  }
  return best;
}
