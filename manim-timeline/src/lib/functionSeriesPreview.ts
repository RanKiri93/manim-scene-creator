import type {
  AxesItem,
  GraphFunctionSeriesItem,
  FunctionLineStyle,
  FunctionSeriesDisplayMode,
} from '@/types/scene';
import {
  functionSeriesChildStartOffset,
  functionSeriesIndices,
  resolveFunctionSeriesDisplayMode,
  resolveFunctionSeriesN,
} from '@/types/scene';
import { effectiveStart } from '@/lib/time';
import type { ItemId, SceneItem } from '@/types/scene';

const SAMPLE_COUNT = 200;

export interface FunctionSeriesCurveLayer {
  /** Unique key within the draw spec. */
  key: string;
  /** Flat [x0, y0, x1, y1, ...] in local (Konva) coordinates. */
  points: number[];
  color: string;
  strokeWidth: number;
  lineStyle: FunctionLineStyle;
  /** 1.0 fully opaque; used for faded replaced curves during transform. */
  opacity: number;
}

export interface FunctionSeriesDrawSpec {
  layers: FunctionSeriesCurveLayer[];
}

/** Compile `jsExpr` once; returns the callable or null on syntax error. */
function compileFn(
  jsExpr: string,
): ((n: number, x: number) => number) | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    return new Function('n', 'x', `"use strict"; return (${jsExpr});`) as (
      n: number,
      x: number,
    ) => number;
  } catch {
    return null;
  }
}

/**
 * Build per-n polylines for every index up to and including `upToN`.
 *
 * - `individual`: y = f(n, x) sampled independently per n.
 * - `partialSum`: y = S_k(x) = Σ_{n=nMin}^{k} f(n, x), built **incrementally** so the
 *   total work is O(|indices| · SAMPLES) instead of O(|indices|² · SAMPLES).
 *
 * A sample column that is non-finite or throws for some term n is permanently
 * invalidated in `partialSum` mode (S_k needs every lower term defined there).
 */
function buildPolylines(
  displayMode: FunctionSeriesDisplayMode,
  fn: (n: number, x: number) => number,
  indices: number[],
  upToN: number,
  xLo: number,
  xHi: number,
  toLocal: (gx: number, gy: number) => { lx: number; ly: number },
): Map<number, number[]> {
  const out = new Map<number, number[]>();
  if (!(xHi > xLo)) return out;
  const xs = new Array<number>(SAMPLE_COUNT + 1);
  for (let s = 0; s <= SAMPLE_COUNT; s++) {
    xs[s] = xLo + (s / SAMPLE_COUNT) * (xHi - xLo);
  }

  if (displayMode === 'individual') {
    for (const n of indices) {
      if (n > upToN) break;
      const pts: number[] = [];
      for (let s = 0; s <= SAMPLE_COUNT; s++) {
        let gy: number;
        try {
          gy = fn(n, xs[s]!);
        } catch {
          continue;
        }
        if (!Number.isFinite(gy)) continue;
        const { lx, ly } = toLocal(xs[s]!, gy);
        pts.push(lx, ly);
      }
      out.set(n, pts);
    }
    return out;
  }

  // partialSum: incremental accumulator + validity mask per x-sample.
  const acc = new Array<number>(SAMPLE_COUNT + 1).fill(0);
  const valid = new Array<boolean>(SAMPLE_COUNT + 1).fill(true);
  for (const n of indices) {
    if (n > upToN) break;
    for (let s = 0; s <= SAMPLE_COUNT; s++) {
      if (!valid[s]) continue;
      let term: number;
      try {
        term = fn(n, xs[s]!);
      } catch {
        valid[s] = false;
        continue;
      }
      if (!Number.isFinite(term)) {
        valid[s] = false;
        continue;
      }
      acc[s]! += term;
    }
    const pts: number[] = [];
    for (let s = 0; s <= SAMPLE_COUNT; s++) {
      if (!valid[s]) continue;
      const y = acc[s]!;
      if (!Number.isFinite(y)) continue;
      const { lx, ly } = toLocal(xs[s]!, y);
      pts.push(lx, ly);
    }
    out.set(n, pts);
  }
  return out;
}

/** Clip a polyline to the first `progress` fraction of its vertices (for Create animation). */
function clipPolylineByProgress(pts: number[], progress: number): number[] {
  if (progress >= 1) return pts;
  if (progress <= 0) return [];
  const totalVerts = pts.length / 2;
  if (totalVerts < 2) return pts;
  const keepVerts = Math.max(2, Math.floor(totalVerts * progress) + 1);
  if (keepVerts >= totalVerts) return pts;
  return pts.slice(0, keepVerts * 2);
}

/** Interpolate two equal-length polylines. Falls back to `b` when lengths differ. */
function lerpPolyline(a: number[], b: number[], t: number): number[] {
  if (a.length !== b.length || a.length === 0) return b;
  const out = new Array<number>(a.length);
  for (let i = 0; i < a.length; i++) {
    out[i] = a[i]! + (b[i]! - a[i]!) * t;
  }
  return out;
}

/**
 * Build the draw spec for a function series at absolute scene time `time`.
 *
 * Accumulation: already-played curves remain at full opacity; the currently-drawing curve
 *   is a partial polyline (first N·progress vertices).
 * Replacement: only the latest curve is visible; during the transform window we linearly
 *   interpolate the polyline between the previous curve and the new one.
 */
export function buildFunctionSeriesDrawSpec(
  item: GraphFunctionSeriesItem,
  axes: AxesItem,
  time: number,
  itemsMap: Map<ItemId, SceneItem>,
  toLocal: (gx: number, gy: number) => { lx: number; ly: number },
): FunctionSeriesDrawSpec | null {
  const t0 = effectiveStart(item, itemsMap);
  const localT = time - t0;
  if (localT < 0) return null;

  const indices = functionSeriesIndices(item);
  if (indices.length === 0) return null;

  const fn = compileFn(item.jsExpr);
  if (!fn) return null;

  const xLo = item.xDomain
    ? Math.min(item.xDomain[0], item.xDomain[1])
    : axes.xRange[0];
  const xHi = item.xDomain
    ? Math.max(item.xDomain[0], item.xDomain[1])
    : axes.xRange[1];

  const displayMode = resolveFunctionSeriesDisplayMode(item);

  // Compute progress per n:
  //   fullyDrawn: before the Create of this curve started and we are past its anim end.
  //   drawing: between start and start+animDuration → fractional progress.
  //   notDrawn: before this curve starts.
  type Phase =
    | { kind: 'notDrawn' }
    | { kind: 'drawing'; progress: number }
    | { kind: 'drawn' };

  const phases = new Map<number, Phase>();
  for (const n of indices) {
    const start = functionSeriesChildStartOffset(item, n);
    const anim = Math.max(0.01, resolveFunctionSeriesN(item, n).animDuration);
    if (localT < start) {
      phases.set(n, { kind: 'notDrawn' });
    } else if (localT < start + anim) {
      phases.set(n, {
        kind: 'drawing',
        progress: Math.max(0, Math.min(1, (localT - start) / anim)),
      });
    } else {
      phases.set(n, { kind: 'drawn' });
    }
  }

  // Find the highest n we actually need a polyline for; in partialSum mode we must
  // build every earlier index too, but `buildPolylines` already stops at `upToN`.
  let maxNeededN = indices[0]!;
  for (const n of indices) {
    if (phases.get(n)!.kind !== 'notDrawn') maxNeededN = n;
  }
  const polylines = buildPolylines(
    displayMode,
    fn,
    indices,
    maxNeededN,
    xLo,
    xHi,
    toLocal,
  );
  const getPoly = (n: number): number[] => polylines.get(n) ?? [];

  const layers: FunctionSeriesCurveLayer[] = [];

  if (item.mode === 'accumulation') {
    for (const n of indices) {
      const phase = phases.get(n)!;
      if (phase.kind === 'notDrawn') continue;
      const res = resolveFunctionSeriesN(item, n);
      const full = getPoly(n);
      if (full.length < 4) continue;
      const pts =
        phase.kind === 'drawing'
          ? clipPolylineByProgress(full, phase.progress)
          : full;
      if (pts.length < 4) continue;
      layers.push({
        key: `fs-${item.id}-${n}`,
        points: pts,
        color: res.color,
        strokeWidth: Math.max(0, res.strokeWidth),
        lineStyle: res.lineStyle,
        opacity: 1,
      });
    }
    return { layers };
  }

  // Replacement mode: find the latest curve whose Create has begun.
  let latestN: number | null = null;
  for (const n of indices) {
    const phase = phases.get(n)!;
    if (phase.kind !== 'notDrawn') latestN = n;
  }
  if (latestN == null) return { layers: [] };

  const latestPhase = phases.get(latestN)!;
  const latestRes = resolveFunctionSeriesN(item, latestN);
  const latestFull = getPoly(latestN);
  if (latestFull.length < 4) return { layers: [] };

  if (latestN === indices[0]) {
    // First curve: Create animation.
    const pts =
      latestPhase.kind === 'drawing'
        ? clipPolylineByProgress(latestFull, latestPhase.progress)
        : latestFull;
    if (pts.length < 4) return { layers: [] };
    layers.push({
      key: `fs-${item.id}-${latestN}`,
      points: pts,
      color: latestRes.color,
      strokeWidth: Math.max(0, latestRes.strokeWidth),
      lineStyle: latestRes.lineStyle,
      opacity: 1,
    });
    return { layers };
  }

  // Subsequent curves: Transform from previous full curve.
  const idx = indices.indexOf(latestN);
  const prevN = indices[idx - 1]!;
  const prevRes = resolveFunctionSeriesN(item, prevN);
  const prevFull = getPoly(prevN);

  if (latestPhase.kind === 'drawing') {
    const p = latestPhase.progress;
    // Interpolate geometry (same sample count → same length).
    const mid =
      prevFull.length === latestFull.length
        ? lerpPolyline(prevFull, latestFull, p)
        : latestFull;
    // Interpolate color (simple channel blend on hex).
    const color = lerpHexColor(prevRes.color, latestRes.color, p);
    const sw =
      prevRes.strokeWidth + (latestRes.strokeWidth - prevRes.strokeWidth) * p;
    layers.push({
      key: `fs-${item.id}-${latestN}-xform`,
      points: mid,
      color,
      strokeWidth: Math.max(0, sw),
      // During transform, use the target curve's line style.
      lineStyle: latestRes.lineStyle,
      opacity: 1,
    });
    return { layers };
  }

  // Fully drawn: only target visible.
  layers.push({
    key: `fs-${item.id}-${latestN}`,
    points: latestFull,
    color: latestRes.color,
    strokeWidth: Math.max(0, latestRes.strokeWidth),
    lineStyle: latestRes.lineStyle,
    opacity: 1,
  });
  return { layers };
}

/** Map a Konva lineStyle to a dash array in px (undefined for solid). */
export function functionSeriesDashArray(
  lineStyle: FunctionLineStyle,
  strokeWidth: number,
): number[] | undefined {
  const base = Math.max(1, strokeWidth);
  switch (lineStyle) {
    case 'solid':
      return undefined;
    case 'dashed':
      return [base * 4, base * 3];
    case 'dotted':
      return [base * 1, base * 2];
  }
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.trim().replace(/^#/, '');
  if (h.length === 3) {
    const r = parseInt(h[0]! + h[0]!, 16);
    const g = parseInt(h[1]! + h[1]!, 16);
    const b = parseInt(h[2]! + h[2]!, 16);
    if ([r, g, b].every((v) => Number.isFinite(v))) return [r, g, b];
    return null;
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if ([r, g, b].every((v) => Number.isFinite(v))) return [r, g, b];
  }
  return null;
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function lerpHexColor(a: string, b: string, t: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return b;
  const tt = clamp01(t);
  return rgbToHex(
    ra[0] + (rb[0] - ra[0]) * tt,
    ra[1] + (rb[1] - ra[1]) * tt,
    ra[2] + (rb[2] - ra[2]) * tt,
  );
}
