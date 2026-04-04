import type { ItemId, SceneItem } from '@/types/scene';
import { getItemBBox, resolvePosition } from '@/lib/resolvePosition';

/**
 * Horizontal shift (Manim x) to apply to every child so the union bbox of all
 * child lines is centered on x=0. Uses each line's resolved position and width.
 */
export function compoundHorizontalShiftX(
  compoundId: ItemId,
  items: Map<ItemId, SceneItem>,
): number {
  const c = items.get(compoundId);
  if (!c || c.kind !== 'compound' || !c.centerHorizontally) return 0;

  let minL = Infinity;
  let maxR = -Infinity;

  for (const id of c.childIds) {
    const ch = items.get(id);
    if (!ch || ch.kind !== 'textLine') continue;
    const p = resolvePosition(ch, items);
    const bb = getItemBBox(ch);
    const left = p.x - bb.w / 2;
    const right = p.x + bb.w / 2;
    minL = Math.min(minL, left);
    maxR = Math.max(maxR, right);
  }

  if (!Number.isFinite(minL)) return 0;
  const mid = (minL + maxR) / 2;
  return -mid;
}

export function resolvePositionWithCompound(
  item: SceneItem,
  items: Map<ItemId, SceneItem>,
): { x: number; y: number } {
  const base = resolvePosition(item, items);
  if (item.kind === 'textLine' && item.parentId) {
    const dx = compoundHorizontalShiftX(item.parentId, items);
    if (dx !== 0) {
      return { x: base.x + dx, y: base.y };
    }
  }
  return base;
}
