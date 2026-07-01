import type { SceneItem, TextLineItem } from '@/types/scene';

/** v40: transform mappings gain `sourceLineIds` (multi-source whole-line morph). */
export function migrateItemsToV40(items: readonly SceneItem[]): SceneItem[] {
  return items.map((item) => {
    if (item.kind !== 'textLine') return { ...item };
    const t = item as TextLineItem;
    const tc = t.transformConfig;
    if (!tc || tc.sourceLineIds?.length) return { ...t };
    return {
      ...t,
      transformConfig: { ...tc, sourceLineIds: [tc.sourceLineId] },
    };
  });
}
