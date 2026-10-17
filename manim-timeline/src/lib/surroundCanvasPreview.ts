import {
  getItemSurroundBBox,
  resolvePositionOrAxesAnchor,
} from '@/lib/resolvePosition';
import {
  canBeSurroundTarget,
  effectiveStart,
  isActiveAtTime,
  isTransformSourceHiddenInPreview,
} from '@/lib/time';
import type {
  ItemId,
  MatrixItem,
  SceneItem,
  SurroundingRectItem,
  TextLineItem,
} from '@/types/scene';
import {
  allCells,
  cellsBounds,
  matrixCellsFor,
  matrixCols,
  matrixGeometry,
  matrixInkBounds,
  matrixRows,
  strikeSegments,
  type Segment2,
} from '@/lib/matrix';
import { matrixViewAt } from '@/lib/matrixSteps';

/** The one matrix a highlight marks entries of (single matrix target), else null. */
function surroundMatrixTarget(sr: SurroundingRectItem, items: Map<ItemId, SceneItem>): MatrixItem | null {
  if (sr.targetIds.length !== 1) return null;
  const t = items.get(sr.targetIds[0]!);
  return t?.kind === 'matrix' ? t : null;
}

/** The matrix as the highlight finds it when it appears (after any matrix steps before). */
function matrixWhenShown(m: MatrixItem, sr: SurroundingRectItem, items: Map<ItemId, SceneItem>): MatrixItem {
  return matrixViewAt(m, items, effectiveStart(sr, items));
}

/**
 * Lines of a `strike` highlight in scene coordinates (as `HebrewMatrix.strike_lines` draws them);
 * null for a box highlight. No entries chosen = the whole matrix.
 */
export function surroundStrikeSegmentsManim(sr: SurroundingRectItem, items: Map<ItemId, SceneItem>): Segment2[] | null {
  if (sr.mark !== 'strike') return null;
  const m = surroundMatrixTarget(sr, items);
  if (!m) return null;
  const view = matrixWhenShown(m, sr, items);
  const rows = matrixRows(view);
  const cols = matrixCols(view);
  const sel = matrixCellsFor(view, sr.cells);
  const pos = resolvePositionOrAxesAnchor(m, items);
  const k = m.scale;
  // `buff` is in scene units, applied after the matrix is scaled (like Manim).
  return strikeSegments(matrixGeometry(view), rows, cols, sel.length ? sel : allCells(rows, cols), Math.max(0, sr.buff) / k).map((s) => ({
    x1: pos.x + s.x1 * k,
    y1: pos.y + s.y1 * k,
    x2: pos.x + s.x2 * k,
    y2: pos.y + s.y2 * k,
  }));
}

export function textLineSurroundCenterAndHalfExtents(
  line: TextLineItem,
  resolvedCenter: { x: number; y: number },
  bb: { w: number; h: number },
): { cx: number; cy: number; hw: number; hh: number } {
  const m = line.measure;
  if (m && m.widthInk > 0) {
    return {
      cx: resolvedCenter.x + m.offsetInkX * line.scale,
      cy: resolvedCenter.y + m.offsetInkY * line.scale,
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
    const view = t.kind === 'matrix' ? matrixWhenShown(t, sr, items) : null;
    const matrixCells = view && sr.targetIds.length === 1 ? matrixCellsFor(view, sr.cells) : [];
    // After a matrix step the whole matrix is measured from that state too.
    const cellBox = !view
      ? null
      : matrixCells.length
        ? cellsBounds(matrixGeometry(view), matrixCells)
        : view !== t
          ? matrixInkBounds(matrixGeometry(view))
          : null;
    if (t.kind === 'matrix' && cellBox) {
      minL = Math.min(minL, pos.x + cellBox.left * t.scale);
      maxR = Math.max(maxR, pos.x + cellBox.right * t.scale);
      minB = Math.min(minB, pos.y + cellBox.bottom * t.scale);
      maxT = Math.max(maxT, pos.y + cellBox.top * t.scale);
      continue;
    }
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
