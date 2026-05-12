import type { SceneItem } from '@/types/scene';

/**
 * v36: Introduces `target_animation` clips (legacy files need no automatic transform).
 */
export function migrateItemsToV36(items: readonly SceneItem[]): SceneItem[] {
  return items.map((item) => ({ ...item }));
}
