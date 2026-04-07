import type {
  ItemId,
  SceneItem,
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

/** Leaf kinds that can be the target of an exit_animation clip. */
export function canBeExitTarget(item: SceneItem): boolean {
  return (
    item.kind === 'textLine' ||
    item.kind === 'axes' ||
    item.kind === 'graphPlot' ||
    item.kind === 'graphDot' ||
    item.kind === 'graphField' ||
    item.kind === 'graphSeriesViz'
  );
}

function exitClipsForTarget(
  targetId: ItemId,
  items: Map<ItemId, SceneItem>,
): ExitAnimationItem[] {
  const out: ExitAnimationItem[] = [];
  for (const it of items.values()) {
    if (
      it.kind === 'exit_animation' &&
      it.targetId === targetId &&
      it.animStyle !== 'none'
    ) {
      out.push(it);
    }
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

/** Run segment length in seconds (intro / main play window, not exit). */
export function runDuration(item: SceneItem, items: Map<ItemId, SceneItem>): number {
  if (item.kind === 'textLine' && item.parentId) {
    const p = items.get(item.parentId);
    if (p?.kind === 'compound') {
      return item.localDuration ?? item.duration;
    }
  }
  if (
    item.kind === 'textLine' ||
    item.kind === 'axes' ||
    item.kind === 'graphPlot' ||
    item.kind === 'graphDot' ||
    item.kind === 'graphField' ||
    item.kind === 'graphSeriesViz'
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
  if (item.parentId) {
    const p = items.get(item.parentId);
    if (p?.kind === 'compound') {
      return item.localDuration ?? item.duration;
    }
  }
  return item.duration;
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

/** Minimum legal `startTime` for an exit clip targeting `targetId`. */
export function minExitStartTime(
  targetId: ItemId,
  items: Map<ItemId, SceneItem>,
): number | null {
  const t = items.get(targetId);
  if (!t || !canBeExitTarget(t)) return null;
  return holdEnd(t, items);
}
