import { useMemo } from 'react';
import type { SceneItem, ItemId } from '@/types/scene';
import { resolvePositionWithCompound } from '@/lib/compoundLayout';

export { resolvePosition } from '@/lib/resolvePosition';
export type { ItemBBox } from '@/lib/resolvePosition';

/**
 * Hook that resolves all visible items' positions, returning a map of ItemId → {x, y}.
 * Text lines inside a compound with `centerHorizontally` get a shared x-offset so the chain is centered.
 */
export function useResolvedPositions(
  visibleItems: SceneItem[],
  allItems: Map<ItemId, SceneItem>,
): Map<ItemId, { x: number; y: number }> {
  return useMemo(() => {
    const result = new Map<ItemId, { x: number; y: number }>();
    for (const item of visibleItems) {
      result.set(item.id, resolvePositionWithCompound(item, allItems));
    }
    return result;
  }, [visibleItems, allItems]);
}
