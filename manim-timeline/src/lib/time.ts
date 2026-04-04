import type { ItemId, SceneItem, TextLineItem, CompoundItem } from '@/types/scene';

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

/** Global end time (exclusive) for visibility during playback. */
export function effectiveEnd(item: SceneItem, items: Map<ItemId, SceneItem>): number {
  const waitAfter = item.waitAfter ?? 0;
  const exit =
    item.kind === 'textLine' || item.kind === 'graph'
      ? (item.exitRunTime ?? 0)
      : 0;

  if (item.kind === 'textLine' && item.parentId) {
    const p = items.get(item.parentId);
    if (p?.kind === 'compound') {
      const d = item.localDuration ?? item.duration;
      return p.startTime + (item.localStart ?? 0) + d + waitAfter + exit;
    }
  }
  return item.startTime + item.duration + waitAfter + exit;
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
  if (item.kind === 'compound') return false;
  const start = effectiveStart(item, items);
  const end = effectiveEnd(item, items);
  return time >= start && time < end;
}
