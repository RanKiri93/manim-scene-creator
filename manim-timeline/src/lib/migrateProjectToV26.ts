import type { SceneItem } from '@/types/scene';

/**
 * v26: introduce `graphFunctionSeries` item kind.
 *
 * No pre-existing items need transformation (the new kind did not exist in prior versions),
 * but we keep the migration step so future updates can rely on a known v26 baseline.
 */
export function migrateItemsToV26(items: readonly SceneItem[]): SceneItem[] {
  return items.map((it) => ({ ...it }));
}
