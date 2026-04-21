import type { SceneItem } from '@/types/scene';

/**
 * v21: Optional per-segment `animSec` on text-line segments (absent = equal split).
 * No structural migration required; older projects load as-is.
 */
export function migrateItemsToV21(items: readonly SceneItem[]): SceneItem[] {
  return items.map((it) => ({ ...it }));
}
