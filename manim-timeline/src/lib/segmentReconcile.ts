/*
 * Keep per-segment settings and references when a text line's source changes.
 *
 * `matchSegments` pairs old segments with new ones, in order:
 *   1. unchanged text (longest common subsequence on text + math flag; language is ignored, so
 *      wrapping a word in \en{} keeps its settings);
 *   2. between two unchanged anchors ("a gap"):
 *      a. same text, different `||` boundaries (a split, a merge or a moved boundary): align by
 *         character position, so an old segment maps to every piece its text ended up in;
 *      b. same number of segments with the same math/text pattern: pair one to one (a rewritten
 *         or retyped segment);
 *      c. otherwise pair by text similarity (edit distance), keeping order, above a threshold.
 * Unpaired old segments are gone; unpaired new segments start with defaults.
 */

import type { ItemId, SegmentStyle } from '@/types/scene';
import type { SegmentRemap } from './remapSegmentRefs';
import type { RawSegment } from './textSegments';

export interface SegmentKey {
  text: string;
  isMath: boolean;
}

export interface SegmentMatch {
  /** Old index → new indices it became, in order (empty when the segment is gone). */
  oldToNew: number[][];
  /** New index → old segment whose style it takes, or `null` for a brand-new segment. */
  donor: (number | null)[];
  /**
   * New index → `[oldIndex, sharedChars, oldChars]` for pieces produced by a re-split (2a), used
   * to share anim time and move waits; `null` elsewhere.
   */
  overlaps: ([number, number, number][] | null)[];
  /** New index → old segments whose wait now follows this piece (re-split only). */
  waitsFrom: number[][];
}

/** Minimum similarity (1 - edit distance / longer length) to pair segments inside a gap. */
export const SEGMENT_MATCH_THRESHOLD = 0.4;

function sameKey(a: SegmentKey, b: SegmentKey): boolean {
  return a.isMath === b.isMath && a.text === b.text;
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/** 1 for equal text, 0 for nothing in common; whitespace at the ends is ignored. */
export function segmentSimilarity(a: SegmentKey, b: SegmentKey): number {
  if (a.isMath !== b.isMath) return 0;
  const x = a.text.trim();
  const y = b.text.trim();
  const longer = Math.max(x.length, y.length);
  if (longer === 0) return 1;
  return 1 - editDistance(x, y) / longer;
}

/** Index pairs of a longest common subsequence under `sameKey`. */
function lcsPairs(oldSegs: readonly SegmentKey[], newSegs: readonly SegmentKey[]): [number, number][] {
  const n = oldSegs.length;
  const m = newSegs.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = sameKey(oldSegs[i]!, newSegs[j]!)
        ? dp[i + 1]![j + 1]! + 1
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (sameKey(oldSegs[i]!, newSegs[j]!)) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

const stripped = (s: SegmentKey) => s.text.replace(/\s+/g, '');

/** Character ranges `[start, end)` of each segment in the whitespace-free concatenation. */
function charRanges(segs: readonly SegmentKey[]): [number, number][] {
  let at = 0;
  return segs.map((s) => {
    const len = stripped(s).length;
    const r: [number, number] = [at, at + len];
    at += len;
    return r;
  });
}

/** Re-split (2a): align by character position. Returns false when the gap is not one. */
function matchResplit(
  oldGap: readonly SegmentKey[],
  newGap: readonly SegmentKey[],
  o0: number,
  n0: number,
  out: SegmentMatch,
): boolean {
  if (oldGap.some((s) => s.isMath) || newGap.some((s) => s.isMath)) return false;
  const oldText = oldGap.map(stripped).join('');
  if (!oldText || oldText !== newGap.map(stripped).join('')) return false;

  const oldR = charRanges(oldGap);
  const newR = charRanges(newGap);
  /** New piece containing character position `p` (the last piece for the end position). */
  const pieceAt = (p: number) => {
    const k = newR.findIndex(([s, e]) => p >= s && p < e);
    return k >= 0 ? k : newR.length - 1;
  };
  const oldAt = (p: number) => {
    const k = oldR.findIndex(([s, e]) => p >= s && p < e);
    return k >= 0 ? k : oldR.length - 1;
  };

  oldR.forEach(([os, oe], i) => {
    const pieces: number[] = [];
    newR.forEach(([ns, ne], j) => {
      if (Math.min(oe, ne) > Math.max(os, ns)) pieces.push(n0 + j);
    });
    out.oldToNew[o0 + i] = pieces.length ? pieces : [n0 + pieceAt(os)];
    // The old segment's wait follows the piece holding its last character.
    out.waitsFrom[n0 + pieceAt(Math.max(os, oe - 1))]!.push(o0 + i);
  });
  newR.forEach(([ns, ne], j) => {
    out.donor[n0 + j] = o0 + oldAt(ns);
    out.overlaps[n0 + j] = oldR.flatMap(([os, oe], i) => {
      const shared = Math.min(oe, ne) - Math.max(os, ns);
      return shared > 0 ? [[o0 + i, shared, oe - os] as [number, number, number]] : [];
    });
  });
  return true;
}

/** Order-preserving one-to-one pairing inside one gap (2b, 2c). */
function matchGap(
  oldSegs: readonly SegmentKey[],
  newSegs: readonly SegmentKey[],
  o0: number,
  o1: number,
  n0: number,
  n1: number,
  out: SegmentMatch,
): void {
  const oLen = o1 - o0;
  const nLen = n1 - n0;
  if (oLen === 0 || nLen === 0) return;
  if (matchResplit(oldSegs.slice(o0, o1), newSegs.slice(n0, n1), o0, n0, out)) return;

  const pair = (i: number, j: number) => {
    out.oldToNew[i] = [j];
    out.donor[j] = i;
  };

  if (oLen === nLen) {
    let samePattern = true;
    for (let k = 0; k < oLen; k++) {
      if (oldSegs[o0 + k]!.isMath !== newSegs[n0 + k]!.isMath) samePattern = false;
    }
    if (samePattern) {
      for (let k = 0; k < oLen; k++) pair(o0 + k, n0 + k);
      return;
    }
  }

  const score = (i: number, j: number) => {
    const s = segmentSimilarity(oldSegs[o0 + i]!, newSegs[n0 + j]!);
    return s >= SEGMENT_MATCH_THRESHOLD ? s : -1;
  };
  const best: number[][] = Array.from({ length: oLen + 1 }, () => new Array<number>(nLen + 1).fill(0));
  for (let i = oLen - 1; i >= 0; i--) {
    for (let j = nLen - 1; j >= 0; j--) {
      const s = score(i, j);
      best[i]![j] = Math.max(
        best[i + 1]![j]!,
        best[i]![j + 1]!,
        s >= 0 ? s + best[i + 1]![j + 1]! : -Infinity,
      );
    }
  }
  let i = 0;
  let j = 0;
  while (i < oLen && j < nLen) {
    const s = score(i, j);
    if (s >= 0 && Math.abs(best[i]![j]! - (s + best[i + 1]![j + 1]!)) < 1e-12) {
      pair(o0 + i, n0 + j);
      i++;
      j++;
    } else if (best[i + 1]![j]! >= best[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
}

/** Match old segments to new ones; see the module comment for the rules. */
export function matchSegments(
  oldSegs: readonly SegmentKey[],
  newSegs: readonly SegmentKey[],
): SegmentMatch {
  const out: SegmentMatch = {
    oldToNew: oldSegs.map(() => []),
    donor: newSegs.map(() => null),
    overlaps: newSegs.map(() => null),
    waitsFrom: newSegs.map(() => []),
  };
  const anchors = lcsPairs(oldSegs, newSegs);
  let o = 0;
  let n = 0;
  for (const [ai, aj] of [...anchors, [oldSegs.length, newSegs.length] as [number, number]]) {
    matchGap(oldSegs, newSegs, o, ai, n, aj, out);
    if (ai < oldSegs.length) {
      out.oldToNew[ai] = [aj];
      out.donor[aj] = ai;
    }
    o = ai + 1;
    n = aj + 1;
  }
  return out;
}

/** True when the edit kept every segment in place with the same text. */
function isIdentity(m: SegmentMatch, oldSegs: readonly SegmentKey[], newSegs: readonly SegmentKey[]): boolean {
  return (
    oldSegs.length === newSegs.length &&
    m.oldToNew.every((js, i) => js.length === 1 && js[0] === i && oldSegs[i]!.text === newSegs[i]!.text)
  );
}

/**
 * New `SegmentStyle`s for `parsed` (the new source), carrying colour, bold, italic, anim time and
 * wait from the old segment(s) each one came from; new segments get `makeDefault`. Also returns
 * the index remap for `remapSegmentRefsInPlace`, or `null` when nothing moved or changed.
 */
export function reconcileSegmentStyles(
  lineId: ItemId,
  oldStyles: readonly SegmentStyle[],
  parsed: readonly RawSegment[],
  makeDefault: (seg: RawSegment) => SegmentStyle,
): { segments: SegmentStyle[]; remap: SegmentRemap | null } {
  const m = matchSegments(oldStyles, parsed);
  const segments = parsed.map((p, j) => {
    const i = m.donor[j];
    if (i === null || i === undefined) return makeDefault(p);
    const base: SegmentStyle = { ...oldStyles[i]!, text: p.text, isMath: p.isMath };
    const overlaps = m.overlaps[j];
    if (!overlaps) return base;
    // Re-split piece: share explicit anim time by characters, and collect the waits that now
    // follow this piece.
    const animParts = overlaps.map(([oi, shared, total]) => {
      const a = oldStyles[oi]!.animSec;
      return a != null && total > 0 ? (a * shared) / total : null;
    });
    const waits = m.waitsFrom[j]!.map((oi) => oldStyles[oi]!.waitAfterSec ?? 0);
    const wait = waits.reduce((a, b) => a + b, 0);
    return {
      ...base,
      animSec: animParts.length && animParts.every((a) => a !== null)
        ? animParts.reduce((a, b) => a! + b!, 0)!
        : undefined,
      waitAfterSec: wait > 0 ? wait : undefined,
    };
  });
  if (isIdentity(m, oldStyles, parsed)) return { segments, remap: null };
  const mathChanged = new Set<number>();
  m.oldToNew.forEach((js, i) => {
    if (js.length === 1 && oldStyles[i]!.isMath && oldStyles[i]!.text !== parsed[js[0]!]!.text) {
      mathChanged.add(i);
    }
  });
  return { segments, remap: { lineId, map: m.oldToNew, mathChanged } };
}
