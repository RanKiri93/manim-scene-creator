import type { SceneItem } from '@/types/scene';

/** v35: Added `graphCurve` kind; legacy files need no structural migration. */
export function migrateItemsToV35(items: readonly SceneItem[]): SceneItem[] {
  return items.map((item) => ({ ...item }));
}
