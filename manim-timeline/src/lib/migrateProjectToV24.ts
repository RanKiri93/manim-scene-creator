import type { GraphPlotItem, SceneItem } from '@/types/scene';

const DEFAULT_STROKE = 2;

/**
 * v24: `strokeWidth` on graph plots (Manim `stroke_width`).
 */
export function migrateItemsToV24(items: readonly SceneItem[]): SceneItem[] {
  return items.map((it) => {
    if (it.kind !== 'graphPlot') return { ...it };
    const p = it as GraphPlotItem;
    const sw = p.strokeWidth;
    if (typeof sw === 'number' && Number.isFinite(sw) && sw >= 0) {
      return { ...it };
    }
    return { ...p, strokeWidth: DEFAULT_STROKE };
  });
}
