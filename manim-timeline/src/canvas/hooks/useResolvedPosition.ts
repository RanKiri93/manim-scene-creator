import { useMemo } from 'react';
import type { SceneItem, ItemId } from '@/types/scene';
import { resolvePosition } from '@/lib/resolvePosition';

export { resolvePosition } from '@/lib/resolvePosition';
export type { ItemBBox } from '@/lib/resolvePosition';

/**
 * Hook that resolves all visible items' positions, returning a map of ItemId → {x, y}.
 */
export function useResolvedPositions(
  visibleItems: SceneItem[],
  allItems: Map<ItemId, SceneItem>,
): Map<ItemId, { x: number; y: number }> {
  return useMemo(() => {
    const result = new Map<ItemId, { x: number; y: number }>();
    for (const item of visibleItems) {
      result.set(item.id, resolvePosition(item, allItems));
    }
    return result;
  }, [visibleItems, allItems]);
}
