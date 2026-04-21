import type { SceneItem } from '@/types/scene';

/**
 * v18: `surroundingRect.duration` is hold-after-intro only; timeline span is
 * `introRunTime + duration`. Previously `duration` stored the full on-timeline length.
 */
export function migrateItemsToV18(items: readonly SceneItem[]): SceneItem[] {
  return items.map((it) => {
    if (it.kind !== 'surroundingRect') return it;
    const sr = it as unknown as { duration: number; introRunTime: number };
    const total = Math.max(1e-6, sr.duration);
    const introCap = Math.max(0.05, sr.introRunTime);
    const intro = Math.min(introCap, total * 0.999);
    const hold = Math.max(0.05, total - intro);
    return { ...(it as object), duration: hold } as SceneItem;
  });
}
