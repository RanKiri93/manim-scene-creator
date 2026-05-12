import type { BlinkTargetSpec, TextLineItem } from '@/types/scene';

export function mathSubtargetsMap(spec: BlinkTargetSpec): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (const row of spec.mathSubtargets ?? []) {
    if (!Number.isInteger(row.segmentIndex) || row.segmentIndex < 0) continue;
    const ch = (row.childIndices ?? []).filter(
      (i) => Number.isInteger(i) && i >= 0,
    );
    if (ch.length === 0) continue;
    m.set(row.segmentIndex, [...new Set(ch)].sort((a, b) => a - b));
  }
  return m;
}

/** Segment indices targeted by this blink row (whole line = all indices). */
export function effectiveBlinkSegmentIndices(
  line: TextLineItem,
  spec: BlinkTargetSpec,
): number[] {
  const n = line.segments.length;
  const raw = spec.segmentIndices?.filter(
    (i) => Number.isInteger(i) && i >= 0 && i < n,
  );
  if (!raw?.length) {
    return n > 0 ? [...Array(n).keys()] : [];
  }
  return [...new Set(raw)].sort((a, b) => a - b);
}

export type TextBlinkPiece =
  | { segmentIndex: number; whole: true }
  | { segmentIndex: number; whole: false; childIndices: number[] };

export function resolveTextBlinkPieces(
  line: TextLineItem,
  spec: BlinkTargetSpec,
): TextBlinkPiece[] {
  const subMap = mathSubtargetsMap(spec);
  return effectiveBlinkSegmentIndices(line, spec).map((i) => {
    const isMath = line.segments[i]?.isMath;
    const ch = isMath ? subMap.get(i) : undefined;
    if (ch && ch.length > 0) {
      return { segmentIndex: i, whole: false, childIndices: ch };
    }
    return { segmentIndex: i, whole: true };
  });
}

/**
 * Use `line.animate.scale` in export when no segment subset and no math-child refinement.
 */
export function textBlinkUsesWholeObjectScale(
  line: TextLineItem,
  spec: BlinkTargetSpec,
): boolean {
  if (line.segments.length === 0) return true;
  const hasSegPick =
    Array.isArray(spec.segmentIndices) && spec.segmentIndices.length > 0;
  if (hasSegPick) return false;
  return mathSubtargetsMap(spec).size === 0;
}

export function textBlinkMobjectExprs(
  v: string,
  line: TextLineItem,
  spec: BlinkTargetSpec,
): string[] {
  const exprs: string[] = [];
  for (const p of resolveTextBlinkPieces(line, spec)) {
    if (p.whole) {
      exprs.push(`${v}[${p.segmentIndex}]`);
    } else {
      for (const c of p.childIndices) {
        exprs.push(`${v}[${p.segmentIndex}][${c}]`);
      }
    }
  }
  return exprs;
}
