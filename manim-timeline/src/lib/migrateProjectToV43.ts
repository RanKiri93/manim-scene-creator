import type { SceneItem } from '@/types/scene';

/** Backfill optional graph-follow presentation defaults for pre-v43 projects. */
export function migrateItemsToV43(items: readonly SceneItem[]): SceneItem[] {
  return items.map((item) => {
    if (item.kind === 'graphDot') {
      return {
        ...item,
        dot: {
          ...item.dot,
          showCoordinates: item.dot.showCoordinates ?? false,
          showProjectionGuides: item.dot.showProjectionGuides ?? false,
        },
      };
    }
    if (item.kind === 'target_animation' && item.mode === 'graphFollow') {
      return {
        ...item,
        targets: item.targets.map((target) => ({ ...target, easing: target.easing ?? 'smooth' })),
      };
    }
    return { ...item };
  });
}
