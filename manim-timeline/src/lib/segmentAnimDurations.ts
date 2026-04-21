import type { SegmentStyle } from '@/types/scene';

/** Matches timeline resize minimum for text-line animation budget. */
export const MIN_TEXTLINE_SEGMENT_ANIM_SEC = 0.01;

/**
 * Resolved Write/FadeIn duration per segment (seconds), summing to `duration`.
 * Omitted `animSec` shares the remainder equally among segments without an explicit value.
 */
export function getSegmentAnimSec(
  segments: readonly SegmentStyle[],
  duration: number,
): number[] {
  const n = segments.length;
  if (n === 0) return [];
  const D = Math.max(0, duration);
  if (D < 1e-12) return Array.from({ length: n }, () => 0);
  const MIN = MIN_TEXTLINE_SEGMENT_ANIM_SEC;

  const raw = segments.map((s) =>
    s.animSec != null && Number.isFinite(s.animSec) && s.animSec >= MIN
      ? s.animSec
      : null,
  );
  const freeCount = raw.filter((v) => v === null).length;
  const hasCustom = freeCount < n;

  if (!hasCustom) {
    return Array.from({ length: n }, () => D / n);
  }

  if (freeCount * MIN > D + 1e-9) {
    return Array.from({ length: n }, () => D / n);
  }

  let sumSpecified = 0;
  for (const v of raw) {
    if (v != null) sumSpecified += v;
  }

  const budgetForSpecified = D - freeCount * MIN;
  const scale =
    sumSpecified > budgetForSpecified + 1e-9 && sumSpecified > 1e-12
      ? Math.max(0, budgetForSpecified) / sumSpecified
      : 1;

  const out: number[] = new Array(n);
  sumSpecified = 0;
  for (let i = 0; i < n; i++) {
    if (raw[i] != null) {
      out[i] = Math.max(MIN, raw[i]! * scale);
      sumSpecified += out[i]!;
    }
  }

  if (freeCount > 0) {
    const rem = D - sumSpecified;
    const perFree = Math.max(MIN, rem / freeCount);
    for (let i = 0; i < n; i++) {
      if (raw[i] == null) out[i] = perFree;
    }
  }

  const drift = D - out.reduce((a, b) => a + b, 0);
  out[n - 1] = Math.max(MIN, out[n - 1]! + drift);

  return out;
}

/**
 * Attach `animSec` only when the split is not uniform; otherwise clear `animSec` on all segments.
 */
export function normalizeSegmentAnimStyles(
  segments: readonly SegmentStyle[],
  duration: number,
): SegmentStyle[] {
  const n = segments.length;
  if (n === 0) return [...segments];
  const arr = getSegmentAnimSec(segments, duration);
  const equal = duration / n;
  const allEqual =
    duration < 1e-12 ||
    arr.every((a) => Math.abs(a - equal) < 1e-4 * Math.max(1, equal));
  return segments.map((s, i) => ({
    ...s,
    animSec: allEqual ? undefined : arr[i],
  }));
}

/**
 * When the line's animation `duration` changes, scale existing custom splits proportionally.
 * If no custom `animSec`, returns segments unchanged (equal split remains implicit).
 */
export function scaleSegmentAnimForLineDuration(
  segments: readonly SegmentStyle[],
  oldDuration: number,
  newDuration: number,
): SegmentStyle[] {
  if (segments.length === 0) return [...segments];
  const hasCustom = segments.some(
    (s) => s.animSec != null && Number.isFinite(s.animSec) && s.animSec > 0,
  );
  if (!hasCustom) return segments.map((s) => ({ ...s }));

  const oldD = Math.max(MIN_TEXTLINE_SEGMENT_ANIM_SEC, oldDuration);
  const newD = Math.max(MIN_TEXTLINE_SEGMENT_ANIM_SEC, newDuration);
  const arr = getSegmentAnimSec(segments, oldD);
  const scaled = arr.map((a) =>
    Math.max(MIN_TEXTLINE_SEGMENT_ANIM_SEC, (a * newD) / oldD),
  );
  const sum = scaled.reduce((a, b) => a + b, 0);
  scaled[scaled.length - 1]! += newD - sum;

  const withAnim = segments.map((s, i) => ({
    ...s,
    animSec: scaled[i],
  }));
  return normalizeSegmentAnimStyles(withAnim, newD);
}

/**
 * Shift a segment's post-wait along the bar without changing total clip length (anim + waits).
 * Positive shift: grow this wait from the previous wait, then from anim[k], anim[k-1], …
 * Negative: mirror prior wait rules, then shrink this wait into anim[k+1] (or anim[k] if last).
 */
export function applyWaitBodyShift(
  segmentIndex: number,
  shiftSec: number,
  segments: readonly SegmentStyle[],
  animDuration: number,
): { segments: SegmentStyle[]; duration: number } {
  const n = segments.length;
  if (n === 0 || segmentIndex < 0 || segmentIndex >= n) {
    return { segments: [...segments], duration: animDuration };
  }

  const MIN = MIN_TEXTLINE_SEGMENT_ANIM_SEC;
  const anim = getSegmentAnimSec(segments, animDuration);
  const w = segments.map((s) => Math.max(0, s.waitAfterSec ?? 0));
  const k = segmentIndex;
  let sh = shiftSec;

  if (sh > 1e-9) {
    if (k > 0) {
      const t = Math.min(sh, w[k - 1]!);
      w[k - 1]! -= t;
      w[k]! += t;
      sh -= t;
    }
    if (sh > 1e-9) {
      let idx = k;
      while (sh > 1e-9 && idx >= 0) {
        const room = Math.max(0, anim[idx]! - MIN);
        const t = Math.min(sh, room);
        anim[idx]! -= t;
        w[k]! += t;
        sh -= t;
        idx--;
      }
    }
  } else if (sh < -1e-9) {
    let need = -sh;
    if (k < n - 1) {
      const t = Math.min(need, w[k + 1]!);
      w[k + 1]! -= t;
      w[k]! += t;
      need -= t;
    }
    if (need > 1e-9) {
      const t = Math.min(need, w[k]!);
      w[k]! -= t;
      if (k < n - 1) {
        anim[k + 1]! += t;
      } else {
        anim[k]! += t;
      }
      need -= t;
    }
  }

  const newDuration = anim.reduce((a, b) => a + b, 0);
  const merged = segments.map((s, i) => ({
    ...s,
    waitAfterSec: w[i]! > 1e-6 ? w[i] : undefined,
    animSec: anim[i],
  }));
  return {
    segments: normalizeSegmentAnimStyles(merged, newDuration),
    duration: newDuration,
  };
}

/**
 * Persist exact resolved anim seconds after edge-drag math. Skips `getSegmentAnimSec`, which
 * otherwise rescales *all* explicit `animSec` values when every segment has one — that broke
 * “only shorten segment k” when resizing a wait against `anim[k]`.
 */
function segmentsFromResolvedAnimAndWaits(
  baselineSegments: readonly SegmentStyle[],
  anim: readonly number[],
  w: readonly number[],
): { segments: SegmentStyle[]; duration: number } {
  const n = baselineSegments.length;
  const newDuration = anim.reduce((a, b) => a + b, 0);
  const MIN = MIN_TEXTLINE_SEGMENT_ANIM_SEC;
  const equal = n > 0 ? newDuration / n : 0;
  const allEqual =
    n === 0 ||
    newDuration < 1e-12 ||
    anim.every((a) => Math.abs(a - equal) < 1e-5 * Math.max(1, equal));

  const segments = baselineSegments.map((s, i) => ({
    ...s,
    waitAfterSec: (w[i] ?? 0) > 1e-6 ? w[i] : undefined,
    animSec:
      allEqual || newDuration < 1e-12
        ? undefined
        : Math.max(MIN, anim[i] ?? 0),
  }));
  return { segments, duration: newDuration };
}

/**
 * Resize a wait from its left or right edge by trading time with the neighboring animation segment
 * so total run length (anim + waits) stays fixed when a neighbor exists.
 *
 * - **Left edge** (between anim[k] and wait[k]): trades with `anim[k]` — growing the wait
 *   shortens segment `k`’s animation (and the opposite when shrinking the wait).
 * - **Right edge** (between wait[k] and anim[k+1]): trades with `anim[k+1]` when k < n-1.
 * - **Right edge** on the last segment’s wait: only `waitAfterSec` changes (clip end moves), like the legacy resize.
 */
export function applyWaitEdgeResize(
  k: number,
  edge: 'left' | 'right',
  targetWait: number,
  baselineSegments: readonly SegmentStyle[],
  baselineAnim: readonly number[],
  baselineW: readonly number[],
): { segments: SegmentStyle[]; duration: number } {
  const n = baselineSegments.length;
  const MIN = MIN_TEXTLINE_SEGMENT_ANIM_SEC;
  if (k < 0 || k >= n) {
    return { segments: [...baselineSegments], duration: baselineAnim.reduce((a, b) => a + b, 0) };
  }

  const anim = [...baselineAnim];
  const w = [...baselineW];
  const w0 = w[k]!;
  const wNewRaw = Math.max(0, targetWait);

  if (edge === 'left') {
    let dw = wNewRaw - w0;
    const maxGrow = Math.max(0, anim[k]! - MIN);
    const maxShrink = -w0;
    dw = Math.max(maxShrink, Math.min(dw, maxGrow));
    w[k] = w0 + dw;
    anim[k]! -= dw;
  } else {
    if (k < n - 1) {
      let dw = wNewRaw - w0;
      const maxGrow = Math.max(0, anim[k + 1]! - MIN);
      const maxShrink = -w0;
      dw = Math.max(maxShrink, Math.min(dw, maxGrow));
      w[k] = w0 + dw;
      anim[k + 1]! -= dw;
    } else {
      w[k] = wNewRaw;
    }
  }

  return segmentsFromResolvedAnimAndWaits(baselineSegments, anim, w);
}

/**
 * Set one segment's animation seconds and rebalance the others proportionally so the sum stays `duration`.
 */
export function setSegmentAnimSecAtIndex(
  segments: readonly SegmentStyle[],
  duration: number,
  index: number,
  newAnim: number,
): SegmentStyle[] {
  const n = segments.length;
  const MIN = MIN_TEXTLINE_SEGMENT_ANIM_SEC;
  if (n === 0 || index < 0 || index >= n) return [...segments];
  const D = Math.max(0, duration);
  const arr = [...getSegmentAnimSec(segments, D)];
  const maxAtI = D - MIN * (n - 1);
  const clamped = Math.max(MIN, Math.min(newAnim, maxAtI));
  const delta = clamped - arr[index]!;
  arr[index] = clamped;
  const others = [...Array(n).keys()].filter((j) => j !== index);
  const restSum = others.reduce((a, j) => a + arr[j]!, 0);
  if (Math.abs(delta) > 1e-12 && restSum > 1e-12) {
    for (const j of others) {
      arr[j] = Math.max(MIN, arr[j]! - (delta * arr[j]!) / restSum);
    }
  } else if (Math.abs(delta) > 1e-12) {
    const each = (D - clamped) / Math.max(1, others.length);
    for (const j of others) arr[j] = Math.max(MIN, each);
  }
  const drift = D - arr.reduce((a, b) => a + b, 0);
  arr[n - 1]! += drift;
  const merged = segments.map((s, i) => ({ ...s, animSec: arr[i] }));
  return normalizeSegmentAnimStyles(merged, D);
}

/** Drag the boundary after segment `leftIndex`: positive delta moves time from the right segment into the left. */
export function shiftAnimBoundaryFromBaseline(
  segments: readonly SegmentStyle[],
  duration: number,
  leftIndex: number,
  deltaSec: number,
  baselineAnim: readonly number[],
): SegmentStyle[] {
  const MIN = MIN_TEXTLINE_SEGMENT_ANIM_SEC;
  const n = segments.length;
  const i = leftIndex;
  if (i < 0 || i >= n - 1) {
    return normalizeSegmentAnimStyles([...segments], duration);
  }
  const lo = baselineAnim[i]!;
  const ro = baselineAnim[i + 1]!;
  const d = Math.min(Math.max(deltaSec, -(lo - MIN)), ro - MIN);
  const arr = [...baselineAnim];
  arr[i] = lo + d;
  arr[i + 1] = ro - d;
  const merged = segments.map((s, j) => ({ ...s, animSec: arr[j] }));
  return normalizeSegmentAnimStyles(merged, duration);
}
