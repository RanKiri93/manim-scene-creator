import type { BlinkAnimationItem, SceneItem } from '@/types/scene';

/**
 * v34: Removes the combined blink `scale_color` mode. Legacy rows become
 * plain scale blinks; users can add a separate color blink clip when needed.
 */
export function migrateItemsToV34(items: readonly SceneItem[]): SceneItem[] {
  return items.map((item) => {
    if (item.kind !== 'blink_animation') return { ...item };
    const blink = item as BlinkAnimationItem & {
      targets: (BlinkAnimationItem['targets'][number] & {
        mode: BlinkAnimationItem['targets'][number]['mode'] | 'scale_color';
      })[];
    };
    return {
      ...blink,
      targets: blink.targets.map((row) => {
        const mode = row.mode as BlinkAnimationItem['targets'][number]['mode'] | 'scale_color';
        return {
          ...row,
          mode: mode === 'scale_color' ? 'scale' : row.mode,
        };
      }),
    };
  });
}
