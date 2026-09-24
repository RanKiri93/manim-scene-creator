import { FRAME_W } from '@/lib/constants';
import type { CameraMoveItem, SceneItem } from '@/types/scene';

export function migrateItemsToV42(items: readonly SceneItem[]): SceneItem[] {
  return items.map((item) => {
    if (item.kind !== 'camera_move') return { ...item };
    const camera = item as CameraMoveItem & { targetWidth?: unknown };
    if (camera.targetWidth != null) return { ...camera };
    return { ...camera, targetWidth: FRAME_W };
  });
}
