import { useMemo } from 'react';
import type { SceneItem, ItemId } from '@/types/scene';
import { resolvePosition } from '@/lib/resolvePosition';
import { targetAnimPreviewAccum } from '@/lib/visualPlaybackPreview';

export { resolvePosition } from '@/lib/resolvePosition';
export type { ItemBBox } from '@/lib/resolvePosition';

/**
 * Hook that resolves all visible items' positions, returning a map of ItemId → {x, y}.
 */
export function useResolvedPositions(
  visibleItems: SceneItem[],
  allItems: Map<ItemId, SceneItem>,
  currentTime: number,
): Map<ItemId, { x: number; y: number }> {
  return useMemo(() => {
    const result = new Map<ItemId, { x: number; y: number }>();
    for (const item of visibleItems) {
      const base = resolvePosition(item, allItems);
      const ta = targetAnimPreviewAccum(item.id, currentTime, allItems);
      result.set(item.id, { x: base.x + ta.dx, y: base.y + ta.dy });
    }
    return result;
  }, [visibleItems, allItems, currentTime]);
}
