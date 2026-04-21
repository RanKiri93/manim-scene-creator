import type { SceneItem } from '@/types/scene';

/**
 * v22: `graphArea` clips (filled regions on axes). No transform for older JSON.
 */
export function migrateItemsToV22(items: readonly SceneItem[]): SceneItem[] {
  return items.map((it) => ({ ...it }));
}
