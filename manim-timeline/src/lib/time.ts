import type {
  ItemId,
  SceneItem,
  SegmentStyle,
  TextLineItem,
  CompoundItem,
  ExitAnimationItem,
} from '@/types/scene';

/** Items shown on the main timeline (not nested under a compound). */
export function isTopLevelItem(item: SceneItem): boolean {
  if (item.kind === 'textLine' && item.parentId) return false;
  return true;
}

export function getCompound(
  items: Map<ItemId, SceneItem>,
  id: ItemId,
): CompoundItem | undefined {
  const it = items.get(id);
  return it?.kind === 'compound' ? it : undefined;
}

/** Objects that can be highlighted with a surrounding rectangle (not another highlight). */
export function canBeSurroundTarget(item: SceneItem): boolean {
  return (
    item.kind === 'textLine' ||
    item.kind === 'axes' ||
    item.kind === 'graphPlot' ||
    item.kind === 'graphDot' ||
    item.kind === 'graphField' ||
    item.kind === 'graphSeriesViz' ||
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
export function effectiveStart(item: SceneItem, items: Map<ItemId, SceneItem>): number {
  if (item.kind === 'textLine' && item.parentId) {
    const p = items.get(item.parentId);
    if (p?.kind === 'compound') {
      return p.startTime + (item.localStart ?? 0);
    }
  }
  return item.startTime;
}

function textLineBaseDuration(item: TextLineItem, items: Map<ItemId, SceneItem>): number {
  if (item.parentId) {
    const p = items.get(item.parentId);
    if (p?.kind === 'compound') {
      return item.localDuration ?? item.duration;
    }
  }
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

/** Text line duration for intro/write animation only (excludes segment `waitAfterSec`). */
export function textLineAnimOnlyDuration(
  item: TextLineItem,
  items: Map<ItemId, SceneItem>,
): number {
  return textLineBaseDuration(item, items);
}

/** Run segment length in seconds (intro / main play window, not exit). */
export function runDuration(item: SceneItem, items: Map<ItemId, SceneItem>): number {
  if (item.kind === 'textLine') {
    return (
      textLineBaseDuration(item, items) + segmentWaitTotal(item.segments)
    );
  }
  if (
    item.kind === 'axes' ||
    item.kind === 'graphPlot' ||
    item.kind === 'graphDot' ||
    item.kind === 'graphField' ||
    item.kind === 'graphSeriesViz' ||
    item.kind === 'shape' ||
    item.kind === 'surroundingRect'
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
 * Exclusive end of on-screen presence: after last exit completes, or +Infinity if no exit clip.
 */
export function effectiveEnd(item: SceneItem, items: Map<ItemId, SceneItem>): number {
  if (item.kind === 'compound' || item.kind === 'exit_animation') {
    return 0;
  }
  const exEnd = exitVisualEndExclusive(item.id, items);
  if (exEnd === null) return Number.POSITIVE_INFINITY;
  return exEnd;
}

/** Finite end for scene length / layout when the object has no exit (hold only). */
export function timelineSpanEnd(item: SceneItem, items: Map<ItemId, SceneItem>): number {
  if (item.kind === 'compound') {
    return item.startTime + item.duration;
  }
  if (item.kind === 'exit_animation') {
    return item.startTime + item.duration;
  }
  const exEnd = exitVisualEndExclusive(item.id, items);
  const he = holdEnd(item, items);
  return exEnd !== null ? Math.max(he, exEnd) : he;
}

export function effectiveDuration(item: TextLineItem, items: Map<ItemId, SceneItem>): number {
  return textLineBaseDuration(item, items) + segmentWaitTotal(item.segments);
}

/** Whether `time` falls inside this item's playback window. */
export function isActiveAtTime(
  item: SceneItem,
  time: number,
  items: Map<ItemId, SceneItem>,
): boolean {
  if (item.kind === 'compound' || item.kind === 'exit_animation') return false;
  const start = effectiveStart(item, items);
  if (time < start) return false;
  const end = effectiveEnd(item, items);
  return time < end;
}

/**
 * Canvas preview: a line used as `transformConfig.sourceLineId` should disappear after
 * the transform animation on the target finishes (same notion as `holdEnd` on the target),
 * otherwise the source LaTeX preview stays on screen forever because `effectiveEnd` has no exit.
 */
export function isTransformSourceHiddenInPreview(
  sourceLine: TextLineItem,
  time: number,
  items: Map<ItemId, SceneItem>,
): boolean {
  const targets: TextLineItem[] = [];
  for (const it of items.values()) {
    if (it.kind !== 'textLine') continue;
    if (it.animStyle !== 'transform') continue;
    if (it.transformConfig?.sourceLineId !== sourceLine.id) continue;
    targets.push(it);
  }
  if (targets.length === 0) return false;
  targets.sort(
    (a, b) =>
      effectiveStart(a, items) - effectiveStart(b, items) ||
      a.id.localeCompare(b.id),
  );
  const lastByStart = targets[targets.length - 1]!;
  return time >= holdEnd(lastByStart, items);
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
