import type { SceneItem, TextLineItem } from '@/types/scene';

/**
 * v33: Text lines cache nested math subobject boxes from measure server (`mathChildMeasures`).
 */
export function migrateItemsToV33(items: readonly SceneItem[]): SceneItem[] {
  return items.map((item) => {
    if (item.kind !== 'textLine') return { ...item };
    const t = item as TextLineItem;
    if (t.mathChildMeasures !== undefined) return { ...t };
    return { ...t, mathChildMeasures: null };
  });
}
