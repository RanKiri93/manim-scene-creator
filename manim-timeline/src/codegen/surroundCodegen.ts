import type {
  ItemId,
  SceneItem,
  SurroundingRectItem,
  TextLineItem,
} from '@/types/scene';
import { canBeSurroundTarget, effectiveStart } from '@/lib/time';
import { pythonStringLiteral } from './texUtils';
import {
  resolveExitTargetsForExport,
  manimColor,
} from './graphCodegen';
import type { ExportLeaf } from './flattenExport';
import { allCells, matrixCellsFor, matrixCols, matrixRows } from '@/lib/matrix';
import { matrixStepClips, matrixViewAt } from '@/lib/matrixSteps';
import { matrixTargetExpr } from './matrixCodegen';

function dedupeTargetIds(ids: readonly ItemId[]): ItemId[] {
  const seen = new Set<ItemId>();
  const out: ItemId[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Axes id for graph overlays; otherwise the item id (line / axes / shape). */
export function surroundPosAnchorId(target: SceneItem): ItemId | null {
  if (!canBeSurroundTarget(target)) return null;
  if (
    target.kind === 'graphPlot' ||
    target.kind === 'graphCurve' ||
    target.kind === 'graphDot' ||
    target.kind === 'graphField' ||
    target.kind === 'graphFunctionSeries' ||
    target.kind === 'graphPointSequence' ||
    target.kind === 'graphArea'
  ) {
    return target.axesId;
  }
  return target.id;
}

function normalizedSegmentIndices(
  line: TextLineItem,
  segmentIndices: number[] | null | undefined,
): number[] {
  const n = line.segments.length;
  if (!n || !segmentIndices?.length) return [];
  const seen = new Set<number>();
  for (const i of segmentIndices) {
    if (Number.isInteger(i) && i >= 0 && i < n) seen.add(i);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Single Python expression suitable as the first argument to SurroundingRectangle.
 */
export function resolveSurroundTargetExpr(
  target: SceneItem,
  idToVarName: Map<ItemId, string>,
  segmentIndices?: number[] | null,
): string | null {
  if (target.kind === 'textLine') {
    const v = idToVarName.get(target.id);
    if (!v) return null;
    const idxs = normalizedSegmentIndices(target, segmentIndices);
    if (idxs.length === 0) return v;
    if (idxs.length === 1) return `${v}[${idxs[0]}]`;
    return `VGroup(${idxs.map((i) => `${v}[${i}]`).join(', ')})`;
  }

  const raw = resolveExitTargetsForExport(target, idToVarName);
  if (!raw) return null;
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) {
    const p = parts[0] ?? null;
    if (p?.startsWith('*')) return p.slice(1);
    return p;
  }
  return `VGroup(${parts.join(', ')})`;
}

/**
 * Python expression for `SurroundingRectangle`'s first argument: one mobject or `VGroup(...)`.
 */
export function resolveSurroundRectTargetExpr(
  item: SurroundingRectItem,
  idToVarName: Map<ItemId, string>,
  itemsMap: Map<ItemId, SceneItem>,
): string | null {
  const ids = dedupeTargetIds(item.targetIds ?? []);
  if (ids.length === 0) return null;
  const parts: string[] = [];
  for (const tid of ids) {
    const tgt = itemsMap.get(tid);
    if (!tgt || !canBeSurroundTarget(tgt)) return null;
    if (ids.length === 1 && tgt.kind === 'matrix') {
      const v = idToVarName.get(tgt.id);
      return v ? matrixTargetExpr(matrixViewAt(tgt, itemsMap, effectiveStart(item, itemsMap)), v, item.cells) : null;
    }
    const seg =
      ids.length === 1 && tgt.kind === 'textLine'
        ? item.segmentIndices
        : null;
    const ex = resolveSurroundTargetExpr(tgt, idToVarName, seg);
    if (!ex) return null;
    parts.push(ex);
  }
  if (parts.length === 1) return parts[0]!;
  return `VGroup(${parts.join(', ')})`;
}

/**
 * True for a highlight on one matrix that a matrix step changes before the highlight appears: it
 * is built just before it plays (around the entries as they are then), not with the definitions.
 */
export function surroundBuiltWhenShown(sr: SurroundingRectItem, itemsMap: Map<ItemId, SceneItem>): boolean {
  if (sr.visibleAtSceneStart) return false;
  const ids = dedupeTargetIds(sr.targetIds ?? []);
  const tgt = ids.length === 1 ? itemsMap.get(ids[0]!) : undefined;
  if (tgt?.kind !== 'matrix') return false;
  const start = effectiveStart(sr, itemsMap);
  return matrixStepClips(tgt.id, itemsMap).some((c) => c.startTime <= start + 1e-9);
}

/**
 * Emit surrounding-rect position block after this leaf's `generate*Pos` so every target is placed.
 */
export function surroundPlacementLeafId(
  sr: SurroundingRectItem,
  flat: ExportLeaf[],
  itemsMap: Map<ItemId, SceneItem>,
): ItemId | null {
  const anchorKeys = new Set<ItemId>();
  for (const tid of dedupeTargetIds(sr.targetIds ?? [])) {
    const tgt = itemsMap.get(tid);
    if (!tgt || !canBeSurroundTarget(tgt)) continue;
    const aid = surroundPosAnchorId(tgt);
    if (aid) anchorKeys.add(aid);
  }
  let bestIdx = -1;
  let bestId: ItemId | null = null;
  for (let i = 0; i < flat.length; i++) {
    const leaf = flat[i]!;
    if (anchorKeys.has(leaf.id) && i > bestIdx) {
      bestIdx = i;
      bestId = leaf.id;
    }
  }
  return bestId;
}

export function generateSurroundingRectPosBlock(
  item: SurroundingRectItem,
  srVar: string,
  idToVarName: Map<ItemId, string>,
  itemsMap: Map<ItemId, SceneItem>,
  indent: number,
): string {
  const pad = ' '.repeat(indent);
  const struck = strikeMatrix(item, itemsMap);
  let s: string;
  if (struck) {
    const v = idToVarName.get(struck.id);
    if (!v) return '';
    const view = matrixViewAt(struck, itemsMap, effectiveStart(item, itemsMap));
    const sel = matrixCellsFor(view, item.cells);
    const cells = (sel.length ? sel : allCells(matrixRows(view), matrixCols(view))).map((c) => `(${c.row}, ${c.col})`).join(', ');
    s = `${pad}${srVar} = ${v}.strike_lines([${cells}], buff=${item.buff.toFixed(4)}, color=${manimColor(item.color)}, stroke_width=${item.strokeWidth.toFixed(4)})\n`;
  } else {
    const expr = resolveSurroundRectTargetExpr(item, idToVarName, itemsMap);
    if (!expr) return '';
    const cr =
      item.cornerRadius > 0
        ? `, corner_radius=${item.cornerRadius.toFixed(4)}`
        : '';
    s = `${pad}${srVar}_tgt = ${expr}\n`;
    s += `${pad}${srVar} = SurroundingRectangle(${srVar}_tgt, buff=${item.buff.toFixed(4)}, color=${manimColor(item.color)}, stroke_width=${item.strokeWidth.toFixed(4)}${cr})\n`;
  }
  if (item.labelText.trim()) {
    s +=
      `${pad}${srVar}_lbl = HebrewMathLine(${pythonStringLiteral(item.labelText.trim())}, font_size=${Math.round(item.labelFontSize)}, hebrew_font="Alef")\n`;
    s += `${pad}${srVar}_lbl.next_to(${srVar}, ${item.labelDir}, buff=0.12)\n`;
  }
  return s;
}

/** The matrix a `strike` highlight crosses entries out of (single matrix target), else null. */
function strikeMatrix(item: SurroundingRectItem, itemsMap: Map<ItemId, SceneItem>) {
  if (item.mark !== 'strike' || item.targetIds.length !== 1) return null;
  const t = itemsMap.get(item.targetIds[0]!);
  return t?.kind === 'matrix' ? t : null;
}

export function generateSurroundingRectPlay(
  item: SurroundingRectItem,
  srVar: string,
  indent: number,
): string {
  const pad = ' '.repeat(indent);
  const rt = Math.max(0.05, item.runTime).toFixed(4);
  if (item.visibleAtSceneStart) return '';
  const intro =
    item.introStyle === 'fade_in' ? `FadeIn(${srVar})` : `Create(${srVar})`;
  if (item.labelText.trim()) {
    return `${pad}self.play(${intro}, Write(${srVar}_lbl), run_time=${rt})\n`;
  }
  return `${pad}self.play(${intro}, run_time=${rt})\n`;
}
