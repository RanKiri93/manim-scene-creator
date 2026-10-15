import type { ItemId, PosStep, SceneItem } from '@/types/scene';

/*
 * Rewrite every reference to a text line's segments (`line[i]`) after its source changed.
 * References to a segment that no longer exists fall back to the whole line: index lists that
 * empty out become `null`, `next_to` segment indices become `null`, transform pairs are dropped.
 * Functions edit the item they are given (works on immer drafts and plain objects alike).
 */

export interface SegmentRemap {
  lineId: ItemId;
  /** Old segment index → new indices it became (several after a split; empty when gone). */
  map: readonly (readonly number[])[];
  /** Old indices of math segments whose text changed; their child indices no longer apply. */
  mathChanged: ReadonlySet<number>;
}

function mapIndices(r: SegmentRemap, i: number): readonly number[] {
  return Number.isInteger(i) && i >= 0 && i < r.map.length ? (r.map[i] ?? []) : [];
}

/** Single-index references (next_to) follow the first piece of a split segment. */
function mapIndex(r: SegmentRemap, i: number): number | null {
  return mapIndices(r, i)[0] ?? null;
}

/** Index lists cover every piece of a split segment. */
function remapIndexList(list: number[] | null | undefined, r: SegmentRemap): number[] | null | undefined {
  if (!list || list.length === 0) return list;
  const out = [...new Set(list.flatMap((i) => mapIndices(r, i)))];
  out.sort((a, b) => a - b);
  return out.length ? out : null;
}

type MathSubtargets = { segmentIndex: number; childIndices: number[] }[] | null | undefined;

function remapMathSubtargets(list: MathSubtargets, r: SegmentRemap): MathSubtargets {
  if (!list || list.length === 0) return list;
  const out = list.flatMap((row) => {
    const j = mapIndex(r, row.segmentIndex);
    if (j === null || mapIndices(r, row.segmentIndex).length !== 1 || r.mathChanged.has(row.segmentIndex)) {
      return [];
    }
    return [{ segmentIndex: j, childIndices: row.childIndices }];
  });
  return out.length ? out : null;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface SegmentTargetRow {
  targetId: ItemId;
  segmentIndices?: number[] | null;
  mathSubtargets?: MathSubtargets;
}

function remapTargetRow(row: SegmentTargetRow, r: SegmentRemap): boolean {
  if (row.targetId !== r.lineId) return false;
  let changed = false;
  if (row.segmentIndices !== undefined) {
    const next = remapIndexList(row.segmentIndices, r);
    if (!sameJson(next, row.segmentIndices)) {
      row.segmentIndices = next;
      changed = true;
    }
  }
  if (row.mathSubtargets !== undefined) {
    const next = remapMathSubtargets(row.mathSubtargets, r);
    if (!sameJson(next, row.mathSubtargets)) {
      row.mathSubtargets = next;
      changed = true;
    }
  }
  return changed;
}

function remapPosSteps(steps: PosStep[], itemId: ItemId, r: SegmentRemap): boolean {
  let changed = false;
  for (const step of steps) {
    if (step.kind !== 'next_to') continue;
    if (step.refKind === 'line' && step.refId === r.lineId && step.refSegmentIndex != null) {
      const next = mapIndex(r, step.refSegmentIndex);
      if (next !== step.refSegmentIndex) {
        step.refSegmentIndex = next;
        changed = true;
      }
    }
    if (itemId === r.lineId && step.selfSegmentIndex != null) {
      const next = mapIndex(r, step.selfSegmentIndex);
      if (next !== step.selfSegmentIndex) {
        step.selfSegmentIndex = next;
        changed = true;
      }
    }
  }
  return changed;
}

/** Apply `r` to every segment reference held by `item`. Returns whether anything changed. */
export function remapSegmentRefsInPlace(item: SceneItem, r: SegmentRemap): boolean {
  let changed = false;

  if ('posSteps' in item && Array.isArray(item.posSteps)) {
    changed = remapPosSteps(item.posSteps, item.id, r) || changed;
  }

  switch (item.kind) {
    case 'blink_animation':
    case 'target_animation':
      for (const row of item.targets) changed = remapTargetRow(row, r) || changed;
      break;
    case 'surroundingRect':
      if (item.targetIds.length === 1 && item.targetIds[0] === r.lineId && item.segmentIndices) {
        const next = remapIndexList(item.segmentIndices, r);
        if (!sameJson(next, item.segmentIndices)) {
          item.segmentIndices = next;
          changed = true;
        }
      }
      break;
    case 'textLine': {
      const tc = item.transformConfig;
      if (!tc) break;
      const entries = Object.entries(tc.segmentPairs ?? {}).map(
        ([t, s]) => [Number(t), s] as [number, number],
      );
      // A split target segment keeps its source for every piece; a split source maps to its first.
      const remapped = entries.flatMap(([t, s]) => {
        const nts = item.id === r.lineId ? mapIndices(r, t) : [t];
        const ns = tc.sourceLineId === r.lineId ? mapIndex(r, s) : s;
        return ns === null ? [] : nts.map((nt) => [nt, ns] as [number, number]);
      });
      const next = Object.fromEntries(remapped) as Record<number, number>;
      if (!sameJson(next, tc.segmentPairs ?? {})) {
        tc.segmentPairs = next;
        changed = true;
      }
      break;
    }
    default:
      break;
  }
  return changed;
}
