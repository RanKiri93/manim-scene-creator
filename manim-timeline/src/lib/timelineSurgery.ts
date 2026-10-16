/**
 * Pure helpers for timeline time edits ("close empty range" / "insert empty time" /
 * "scale a range").
 *
 * Insert and close only ever create or remove *empty* time: they refuse to run when
 * any visual clip or narration audio clip overlaps the affected range/point, so no
 * clip is ever split or trimmed. Scale stretches the clips inside a range (never
 * narration) and refuses clips that cross its edges. Callers apply the returned start-time
 * updates in a single store mutation (one undo step).
 */
import type { AudioTrackItem, ItemId, SceneItem } from '@/types/scene';
import { effectiveStart, isTopLevelItem, runDuration } from '@/lib/time';
import { itemClipDisplayName } from '@/lib/itemDisplayName';
import { audioTrackLabel, explicitVisualOwnerForAudioTrack } from '@/lib/audioBinding';

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

// ── Scale a range ────────────────────────────────────────────────────────

/** Slowest / fastest a range may be scaled in one edit. */
export const SCALE_FACTOR_MIN = 0.25;
export const SCALE_FACTOR_MAX = 4;

export interface ScaledStartUpdate extends StartTimeUpdate {
  /** True for clips inside the range: their own durations are multiplied by the factor. */
  scaled: boolean;
}

export interface ScaleRangePlan {
  ok: boolean;
  error: string | null;
  blockers: SurgeryBlocker[];
  itemUpdates: ScaledStartUpdate[];
  audioUpdates: StartTimeUpdate[];
}

/** Validate a scale-range request. */
export function validateScaleRange(
  start: number,
  end: number,
  factor: number,
): { ok: true } | { ok: false; error: string } {
  const range = validateCloseRange(start, end);
  if (!range.ok) return range;
  if (!Number.isFinite(factor) || factor < SCALE_FACTOR_MIN || factor > SCALE_FACTOR_MAX) {
    return { ok: false, error: `Scale factor must be between ${SCALE_FACTOR_MIN} and ${SCALE_FACTOR_MAX}.` };
  }
  return { ok: true };
}

/**
 * Plan stretching (factor > 1) or squeezing (factor < 1) `[start, end)`: clips that start inside
 * move to `start + (t - start) · factor` and their durations scale by `factor`; clips and audio at
 * or after `end` shift by `(factor - 1) · (end - start)`. A clip crossing `start` or `end` blocks the
 * edit, and so does narration inside the range (audio cannot be stretched).
 */
export function planScaleRange(
  itemSpans: readonly SurgerySpan[],
  audioSpans: readonly SurgerySpan[],
  start: number,
  end: number,
  factor: number,
): ScaleRangePlan {
  const validation = validateScaleRange(start, end, factor);
  if (!validation.ok) {
    return { ok: false, error: validation.error, blockers: [], itemUpdates: [], audioUpdates: [] };
  }
  const blockers: SurgeryBlocker[] = [];
  for (const s of itemSpans) {
    if (spanCoversPoint(s.start, s.end, start) || spanCoversPoint(s.start, s.end, end)) {
      blockers.push({ kind: 'item', id: s.id, label: s.label, start: s.start, end: s.end });
    }
  }
  for (const s of audioSpans) {
    if (spansOverlapRange(s.start, s.end, start, end)) {
      blockers.push({ kind: 'audio', id: s.id, label: s.label, start: s.start, end: s.end });
    }
  }
  if (blockers.length > 0) {
    const audio = blockers.some((b) => b.kind === 'audio');
    return {
      ok: false,
      error: audio
        ? 'Narration plays inside the range — audio cannot be stretched; insert pauses instead.'
        : 'A clip crosses the range edge — pick edges between clips.',
      blockers: sortBlockers(blockers),
      itemUpdates: [],
      audioUpdates: [],
    };
  }
  const shift = (factor - 1) * (end - start);
  const itemUpdates: ScaledStartUpdate[] = [];
  for (const s of itemSpans) {
    if (s.start >= end - TIMELINE_SURGERY_EPS) {
      itemUpdates.push({ id: s.id, startTime: Math.max(0, s.start + shift), scaled: false });
    } else if (s.start >= start - TIMELINE_SURGERY_EPS) {
      itemUpdates.push({ id: s.id, startTime: start + (s.start - start) * factor, scaled: true });
    }
  }
  const audioUpdates: StartTimeUpdate[] = [];
  for (const s of audioSpans) {
    if (s.start >= end - TIMELINE_SURGERY_EPS) audioUpdates.push({ id: s.id, startTime: Math.max(0, s.start + shift) });
  }
  return { ok: true, error: null, blockers: [], itemUpdates, audioUpdates };
}

const scaleSec = (v: number | undefined, factor: number) => (v == null ? v : v * factor);

/**
 * The duration fields of one clip multiplied by `factor` (clip length, segment anim times and
 * waits, per-curve / per-point timings), as a patch.
 */
export function scaledDurationPatch(item: SceneItem, factor: number): Partial<SceneItem> {
  if (item.kind === 'surroundingRect') return { runTime: Math.max(0.05, item.runTime * factor) };
  if (!('duration' in item)) return {};
  const patch: Record<string, unknown> = { duration: Math.max(0.01, item.duration * factor) };
  if (item.kind === 'textLine') {
    patch.segments = item.segments.map((seg) => ({
      ...seg,
      ...(seg.animSec != null ? { animSec: scaleSec(seg.animSec, factor) } : {}),
      ...(seg.waitAfterSec != null ? { waitAfterSec: scaleSec(seg.waitAfterSec, factor) } : {}),
    }));
  }
  if (item.kind === 'graphFunctionSeries' || item.kind === 'graphPointSequence') {
    patch.defaults = {
      ...item.defaults,
      animDuration: item.defaults.animDuration * factor,
      waitAfter: item.defaults.waitAfter * factor,
    };
    patch.perN = Object.fromEntries(
      Object.entries(item.perN as Record<string, { animDuration?: number; waitAfter?: number }>).map(([n, row]) => [
        n,
        { ...row, ...(row.animDuration != null ? { animDuration: row.animDuration * factor } : {}), ...(row.waitAfter != null ? { waitAfter: row.waitAfter * factor } : {}) },
      ]),
    );
  }
  return patch as Partial<SceneItem>;
}

/** Map the playhead through a scale-range edit. */
export function mapScaleRangePlayhead(t: number, start: number, end: number, factor: number): number {
  if (t >= end) return Math.max(0, t + (factor - 1) * (end - start));
  if (t > start) return start + (t - start) * factor;
  return t;
}

// ── One edit, applied without the store ──────────────────────────────────

/** A timeline time edit: insert empty time, remove an empty range, or scale a range. */
export type TimelineEdit =
  | { op: 'insert'; at: number; seconds: number }
  | { op: 'remove'; from: number; to: number }
  | { op: 'scale'; from: number; to: number; factor: number };

export interface TimelineEditResult {
  ok: boolean;
  error: string | null;
  blockers: SurgeryBlocker[];
  items: Map<ItemId, SceneItem>;
  audioItems: AudioTrackItem[];
}

/**
 * Apply a time edit to copies of `items` and `audioItems` (the store's three actions do the same
 * on live state). Linked audio follows its visual owner. Nothing changes when the edit is blocked.
 */
export function applyTimelineEdit(
  items: ReadonlyMap<ItemId, SceneItem>,
  audioItems: readonly AudioTrackItem[],
  edit: TimelineEdit,
): TimelineEditResult {
  const live = new Map(items);
  const { itemSpans, audioSpans } = collectSurgerySpans(live, audioItems);
  const plan =
    edit.op === 'insert'
      ? planInsertTime(itemSpans, audioSpans, edit.at, edit.seconds)
      : edit.op === 'remove'
        ? planCloseRange(itemSpans, audioSpans, edit.from, edit.to)
        : planScaleRange(itemSpans, audioSpans, edit.from, edit.to, edit.factor);
  if (!plan.ok) {
    return { ok: false, error: plan.error, blockers: plan.blockers, items: live, audioItems: [...audioItems] };
  }
  for (const u of plan.itemUpdates) {
    const item = live.get(u.id);
    if (!item) continue;
    const scaled = edit.op === 'scale' && (u as ScaledStartUpdate).scaled ? scaledDurationPatch(item, edit.factor) : {};
    live.set(u.id, { ...item, ...scaled, startTime: Math.max(0, u.startTime) } as SceneItem);
  }
  const audioStarts = new Map(plan.audioUpdates.map((u) => [u.id, u.startTime]));
  const audio = audioItems.map((track) => {
    const owner = explicitVisualOwnerForAudioTrack(live, track.id);
    if (owner) return { ...track, startTime: Math.max(0, effectiveStart(owner, live)) };
    const t = audioStarts.get(track.id);
    return t == null ? track : { ...track, startTime: Math.max(0, t) };
  });
  return { ok: true, error: null, blockers: [], items: live, audioItems: audio };
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
