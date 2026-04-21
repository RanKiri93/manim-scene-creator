import type {
  ItemId,
  SceneItem,
  SegmentStyle,
  TextLineItem,
  ExitAnimationItem,
} from '@/types/scene';

/** Items shown on the main timeline. */
export function isTopLevelItem(_item: SceneItem): boolean {
  return true;
}

/** Objects that can be highlighted with a surrounding rectangle (not another highlight). */
export function canBeSurroundTarget(item: SceneItem): boolean {
  return (
    item.kind === 'textLine' ||
    item.kind === 'axes' ||
    item.kind === 'graphPlot' ||
    item.kind === 'graphDot' ||
    item.kind === 'graphField' ||
    item.kind === 'graphFunctionSeries' ||
    item.kind === 'graphArea' ||
    item.kind === 'shape'
  );
}

/** Objects that can be the target of an exit_animation clip (includes surroundingRect). */
export function canBeExitTarget(item: SceneItem): boolean {
  return canBeSurroundTarget(item) || item.kind === 'surroundingRect';
}

function exitClipsForTarget(
  targetId: ItemId,
  items: Map<ItemId, SceneItem>,
): ExitAnimationItem[] {
  const out: ExitAnimationItem[] = [];
  for (const it of items.values()) {
    if (it.kind !== 'exit_animation') continue;
    const hit = it.targets.some(
      (t) => t.targetId === targetId && t.animStyle !== 'none',
    );
    if (hit) out.push(it);
  }
  return out;
}

/** Latest exclusive end time among exit clips targeting this id (none if no such clips). */
export function exitVisualEndExclusive(
  targetId: ItemId,
  items: Map<ItemId, SceneItem>,
): number | null {
  const clips = exitClipsForTarget(targetId, items);
  if (clips.length === 0) return null;
  let max = 0;
  for (const ex of clips) {
    max = Math.max(max, ex.startTime + ex.duration);
  }
  return max;
}

/** Earliest exit clip by start time (for deterministic codegen if multiple exist). */
export function earliestExitClipForTarget(
  targetId: ItemId,
  items: Map<ItemId, SceneItem>,
): ExitAnimationItem | null {
  const clips = exitClipsForTarget(targetId, items);
  if (clips.length === 0) return null;
  clips.sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
  return clips[0] ?? null;
}

/** Global start time for any scene item (for playback & export ordering). */
export function effectiveStart(item: SceneItem, _items: Map<ItemId, SceneItem>): number {
  return item.startTime;
}

function textLineBaseDuration(item: TextLineItem): number {
  return item.duration;
}

/** Sum of positive per-segment post-waits (timeline + export). */
export function segmentWaitTotal(segments: readonly SegmentStyle[]): number {
  let t = 0;
  for (const s of segments) {
    const w = s.waitAfterSec;
    if (w != null && w > 0) t += w;
  }
  return t;
}

export { applyWaitBodyShift } from './segmentAnimDurations';

/** Text line duration for intro/write animation only (excludes segment `waitAfterSec`). */
export function textLineAnimOnlyDuration(
  item: TextLineItem,
  _items: Map<ItemId, SceneItem>,
): number {
  return textLineBaseDuration(item);
}

/** Run segment length in seconds (intro / main play window, not exit). */
export function runDuration(item: SceneItem, _items: Map<ItemId, SceneItem>): number {
  if (item.kind === 'textLine') {
    return textLineBaseDuration(item) + segmentWaitTotal(item.segments);
  }
  if (item.kind === 'surroundingRect') {
    return Math.max(0.05, item.runTime);
  }
  if (
    item.kind === 'axes' ||
    item.kind === 'graphPlot' ||
    item.kind === 'graphDot' ||
    item.kind === 'graphField' ||
    item.kind === 'graphFunctionSeries' ||
    item.kind === 'graphArea' ||
    item.kind === 'shape'
  ) {
    return item.duration;
  }
  return 0;
}

/** Global time when the target's run segment ends (exit may start at or after this). */
export function holdEnd(item: SceneItem, items: Map<ItemId, SceneItem>): number {
  return effectiveStart(item, items) + runDuration(item, items);
}

/**
 * Exclusive end of on-screen presence for preview. With **no** exit clip targeting this id,
 * returns +Infinity so lines/shapes/graphs stay on the canvas after their timeline segment (like
 * Manim). With an exit, returns the later of `holdEnd` and when that exit finishes.
 * Use `timelineSpanEnd` for finite scene-length / layout.
 */
export function effectiveEnd(item: SceneItem, items: Map<ItemId, SceneItem>): number {
  if (item.kind === 'exit_animation') {
    return 0;
  }
  const exEnd = exitVisualEndExclusive(item.id, items);
  if (exEnd === null) return Number.POSITIVE_INFINITY;
  const he = holdEnd(item, items);
  return Math.max(he, exEnd);
}

/** Finite end for scene length / layout when the object has no exit (hold only). */
export function timelineSpanEnd(item: SceneItem, items: Map<ItemId, SceneItem>): number {
  if (item.kind === 'exit_animation') {
    return item.startTime + item.duration;
  }
  const exEnd = exitVisualEndExclusive(item.id, items);
  const he = holdEnd(item, items);
  return exEnd !== null ? Math.max(he, exEnd) : he;
}

export function effectiveDuration(item: TextLineItem, _items: Map<ItemId, SceneItem>): number {
  return textLineBaseDuration(item) + segmentWaitTotal(item.segments);
}

/** Whether `time` falls inside this item's playback window. */
export function isActiveAtTime(
  item: SceneItem,
  time: number,
  items: Map<ItemId, SceneItem>,
): boolean {
  if (item.kind === 'exit_animation') return false;
  const start = effectiveStart(item, items);
  if (time < start) return false;
  const end = effectiveEnd(item, items);
  return time < end;
}

/**
 * Canvas preview: a line used as `transformConfig.sourceLineId` should disappear after
 * the transform `play()` on the target finishes. Export uses `run_time=item.duration` then
 * optional `wait()` for segment post-waits — the source mobject is gone after `play`, not after
 * those waits, so we must not use `holdEnd` (which includes post-waits) or the preview keeps
 * drawing the source during pauses after the morph. Without this, `effectiveEnd` on the source
 * is still +Infinity (no exit), so the LaTeX preview would never leave.
 */
export function isTransformSourceHiddenInPreview(
  sourceLine: TextLineItem,
  time: number,
  items: Map<ItemId, SceneItem>,
): boolean {
  let hideAt = Number.POSITIVE_INFINITY;
  for (const it of items.values()) {
    if (it.kind !== 'textLine') continue;
    if (it.animStyle !== 'transform') continue;
    if (it.transformConfig?.sourceLineId !== sourceLine.id) continue;
    const end =
      effectiveStart(it, items) + textLineAnimOnlyDuration(it, items);
    hideAt = Math.min(hideAt, end);
  }
  if (hideAt === Number.POSITIVE_INFINITY) return false;
  return time >= hideAt;
}

/** Minimum legal `startTime` for an exit clip targeting `targetId`. */
export function minExitStartTime(
  targetId: ItemId,
  items: Map<ItemId, SceneItem>,
): number | null {
  const t = items.get(targetId);
  if (!t || !canBeExitTarget(t)) return null;
  return holdEnd(t, items);
}

/** Latest `holdEnd` among all non–`none` targets on this exit clip (null if none apply). */
export function minExitStartTimeForClip(
  exit: ExitAnimationItem,
  items: Map<ItemId, SceneItem>,
): number | null {
  const mins: number[] = [];
  for (const t of exit.targets) {
    if (t.animStyle === 'none') continue;
    const m = minExitStartTime(t.targetId, items);
    if (m != null) mins.push(m);
  }
  if (mins.length === 0) return null;
  return Math.max(...mins);
}
