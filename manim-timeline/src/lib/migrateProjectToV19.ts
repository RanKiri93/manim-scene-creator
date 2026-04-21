import type { SceneItem } from '@/types/scene';

/**
 * v19: surrounding rect uses `runTime` only; drop `duration` (hold) and `introRunTime`.
 * From v18, keep the former `introRunTime` as `runTime`.
 */
export function migrateItemsToV19(items: readonly SceneItem[]): SceneItem[] {
  return items.map((it) => {
    if (it.kind !== 'surroundingRect') return it;
    const r = it as unknown as Record<string, unknown>;
    if (typeof r.runTime === 'number' && Number.isFinite(r.runTime)) {
      const { duration: _d, introRunTime: _i, ...rest } = r;
      return { ...rest, runTime: Math.max(0.05, r.runTime) } as SceneItem;
    }
    const intro = Math.max(
      0.05,
      typeof r.introRunTime === 'number' ? r.introRunTime : 0.45,
    );
    const { duration: _dur, introRunTime: _intro, ...rest } = r;
    return { ...rest, runTime: intro } as SceneItem;
  });
}
