import type { SceneItem } from '@/types/scene';

/**
 * v41: new `image` scene item kind (still pictures under `assets/textures/`).
 * No existing item shape changes, so this is a pass-through that records the
 * schema version. Idempotent: running it twice is a no-op.
 */
export function migrateItemsToV41(items: readonly SceneItem[]): SceneItem[] {
  return items.map((item) => ({ ...item }));
}
