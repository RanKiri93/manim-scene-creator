import {
  getItemSurroundBBox,
  resolvePositionOrAxesAnchor,
} from '@/lib/resolvePosition';
import {
  canBeSurroundTarget,
  isActiveAtTime,
  isTransformSourceHiddenInPreview,
} from '@/lib/time';
import type {
  ItemId,
  SceneItem,
  SurroundingRectItem,
  TextLineItem,
} from '@/types/scene';

function textLineSurroundCenterAndHalfExtents(
  line: TextLineItem,
  resolvedCenter: { x: number; y: number },
  bb: { w: number; h: number },
): { cx: number; cy: number; hw: number; hh: number } {
  const m = line.measure;
  if (m && m.widthInk > 0) {
    return {
      cx: resolvedCenter.x + m.offsetInkX,
      cy: resolvedCenter.y + m.offsetInkY,
      hw: bb.w / 2,
      hh: bb.h / 2,
    };
  }
  return { cx: resolvedCenter.x, cy: resolvedCenter.y, hw: bb.w / 2, hh: bb.h / 2 };
}

function targetVisibleForSurroundPreview(
  item: SceneItem,
  time: number,
  items: Map<ItemId, SceneItem>,
  selectedIds: Set<ItemId>,
): boolean {
  if (!isActiveAtTime(item, time, items)) return false;
  if (item.kind === 'textLine') {
    return (
      !isTransformSourceHiddenInPreview(item, time, items) ||
      selectedIds.has(item.id)
    );
  }
  return true;
}

/**
 * Union of target bboxes in Manim coordinates (y up), inflated by `buff`.
 * Returns null if the highlight is inactive, any target is missing or not visible for preview,
 * or `targetIds` is empty.
 */
export function surroundPreviewBBoxManim(
  sr: SurroundingRectItem,
  items: Map<ItemId, SceneItem>,
  time: number,
  selectedIds: Set<ItemId>,
): { left: number; right: number; bottom: number; top: number } | null {
  if (!isActiveAtTime(sr, time, items)) return null;
  if (sr.targetIds.length === 0) return null;

  let minL = Infinity;
  let maxR = -Infinity;
  let minB = Infinity;
  let maxT = -Infinity;

  for (const tid of sr.targetIds) {
    const t = items.get(tid);
    if (!t || !canBeSurroundTarget(t)) return null;
    if (!targetVisibleForSurroundPreview(t, time, items, selectedIds)) return null;

    const pos = resolvePositionOrAxesAnchor(t, items);
    const bb = getItemSurroundBBox(t, items);
    const { cx, cy, hw, hh } =
      t.kind === 'textLine'
        ? textLineSurroundCenterAndHalfExtents(t, pos, bb)
        : { cx: pos.x, cy: pos.y, hw: bb.w / 2, hh: bb.h / 2 };

    minL = Math.min(minL, cx - hw);
    maxR = Math.max(maxR, cx + hw);
    minB = Math.min(minB, cy - hh);
    maxT = Math.max(maxT, cy + hh);
  }

  const buff = Math.max(0, sr.buff);
  return {
    left: minL - buff,
    right: maxR + buff,
    bottom: minB - buff,
    top: maxT + buff,
  };
}
