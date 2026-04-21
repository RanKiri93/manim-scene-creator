import type { GraphPlotItem, SceneItem } from '@/types/scene';

/**
 * v23: optional `xDomain` on graph plots (sampling interval; null = full axes x range).
 */
export function migrateItemsToV23(items: readonly SceneItem[]): SceneItem[] {
  return items.map((it) => {
    if (it.kind !== 'graphPlot') return { ...it };
    const p = it as GraphPlotItem;
    if (
      Array.isArray(p.xDomain) &&
      p.xDomain.length === 2 &&
      typeof p.xDomain[0] === 'number' &&
      typeof p.xDomain[1] === 'number'
    ) {
      return { ...it };
    }
    return { ...p, xDomain: null };
  });
}
