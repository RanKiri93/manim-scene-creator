import type { AxesItem, SceneItem } from '@/types/scene';

/**
 * v31: Axis tips use Manim `tip_height` / `tip_width`; legacy `tipLength` maps to `tipHeight`.
 */
export function migrateItemsToV31(items: readonly SceneItem[]): SceneItem[] {
  return items.map((item) => {
    if (item.kind !== 'axes') return { ...item };
    const ax = item as AxesItem;
    const legacy = ax.tipLength;
    const hasH =
      typeof ax.tipHeight === 'number' && Number.isFinite(ax.tipHeight);
    const next: AxesItem = {
      ...ax,
      tipHeight:
        hasH
          ? ax.tipHeight
          : typeof legacy === 'number' && Number.isFinite(legacy)
            ? Math.max(0.05, legacy)
            : undefined,
      tipLength: undefined,
    };
    return next;
  });
}
