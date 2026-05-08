import type { SceneItem } from '@/types/scene';

/**
 * v32: Introduces `blink_animation` items (no automatic item transforms needed; forward-compat).
 */
export function migrateItemsToV32(items: readonly SceneItem[]): SceneItem[] {
  return items.map((item) => ({ ...item }));
}
