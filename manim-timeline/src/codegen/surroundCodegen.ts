import type {
  ItemId,
  SceneItem,
  SurroundingRectItem,
  TextLineItem,
} from '@/types/scene';
import { canBeSurroundTarget } from '@/lib/time';
import { pythonStringLiteral } from './texUtils';
import {
  resolveExitTargetsForExport,
  manimColor,
} from './graphCodegen';
import type { ExportLeaf } from './flattenExport';

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
    target.kind === 'graphDot' ||
    target.kind === 'graphField' ||
    target.kind === 'graphFunctionSeries' ||
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
  const expr = resolveSurroundRectTargetExpr(item, idToVarName, itemsMap);
  if (!expr) return '';
  const cr =
    item.cornerRadius > 0
      ? `, corner_radius=${item.cornerRadius.toFixed(4)}`
      : '';
  let s = `${pad}${srVar}_tgt = ${expr}\n`;
  s += `${pad}${srVar} = SurroundingRectangle(${srVar}_tgt, buff=${item.buff.toFixed(4)}, color=${manimColor(item.color)}, stroke_width=${item.strokeWidth.toFixed(4)}${cr})\n`;
  if (item.labelText.trim()) {
    s +=
      `${pad}${srVar}_lbl = Text(${pythonStringLiteral(item.labelText.trim())}, font_size=${Math.round(item.labelFontSize)})\n`;
    s += `${pad}${srVar}_lbl.next_to(${srVar}, ${item.labelDir}, buff=0.12)\n`;
  }
  return s;
}

export function generateSurroundingRectPlay(
  item: SurroundingRectItem,
  srVar: string,
  indent: number,
): string {
  const pad = ' '.repeat(indent);
  const rt = Math.max(0.05, item.runTime).toFixed(4);
  const intro =
    item.introStyle === 'fade_in' ? `FadeIn(${srVar})` : `Create(${srVar})`;
  if (item.labelText.trim()) {
    return `${pad}self.play(${intro}, Write(${srVar}_lbl), run_time=${rt})\n`;
  }
  return `${pad}self.play(${intro}, run_time=${rt})\n`;
}
