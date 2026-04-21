import type { ItemId, SceneItem, TextLineItem } from '@/types/scene';

/** Persisted compound clip shape (removed in v16). */
interface LegacyCompoundItem {
  kind: 'compound';
  id: ItemId;
  label: string;
  layer: number;
  startTime: number;
  duration: number;
  childIds: ItemId[];
  centerHorizontally?: boolean;
}

/** Text line as saved before v16 (optional compound nesting). */
type LegacyTextLineItem = TextLineItem & {
  parentId?: ItemId | null;
  localStart?: number;
  localDuration?: number;
};

export type PreV16SceneItem = SceneItem | LegacyCompoundItem | LegacyTextLineItem;

/**
 * v16: Remove compound clips — promote nested text lines to top-level with global timing.
 */
export function migrateItemsToV16(items: readonly PreV16SceneItem[]): SceneItem[] {
  const byId = new Map<ItemId, PreV16SceneItem>(
    items.map((i) => [i.id, i]),
  );

  for (const it of items) {
    if (it.kind !== 'textLine') continue;
    const tl = it as LegacyTextLineItem;
    if (!tl.parentId) continue;
    const p = byId.get(tl.parentId);
    if (!p || (p as { kind?: string }).kind !== 'compound') continue;
    const c = p as LegacyCompoundItem;
    const base = tl.localDuration ?? tl.duration;
    const promoted: TextLineItem = {
      ...(tl as TextLineItem),
      startTime: c.startTime + (tl.localStart ?? 0),
      duration: base,
      layer: c.layer,
    };
    const rec = promoted as unknown as Record<string, unknown>;
    delete rec.parentId;
    delete rec.localStart;
    delete rec.localDuration;
    byId.set(tl.id, promoted);
  }

  return items
    .filter((i) => (i as { kind?: string }).kind !== 'compound')
    .map((i) => (byId.get(i.id) ?? i) as SceneItem);
}
