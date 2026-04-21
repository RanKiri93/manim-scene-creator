import type { ItemId, SceneItem, SurroundingRectItem } from '@/types/scene';

/** Saved v16 surrounding rect (single `targetId`). */
type LegacySurroundingRect = Omit<SurroundingRectItem, 'targetIds'> & {
  targetIds?: ItemId[];
  targetId?: ItemId;
};

/**
 * v17: `surroundingRect` uses `targetIds[]` instead of `targetId`.
 */
export function migrateItemsToV17(items: readonly SceneItem[]): SceneItem[] {
  return items.map((it) => {
    if (it.kind !== 'surroundingRect') return it;
    const r = it as unknown as LegacySurroundingRect;
    const { targetId, targetIds: legacyIds, ...rest } = r;
    const targetIds: ItemId[] =
      legacyIds && legacyIds.length > 0
        ? legacyIds
        : targetId
          ? [targetId]
          : [];
    return { ...rest, targetIds } as SurroundingRectItem;
  });
}
