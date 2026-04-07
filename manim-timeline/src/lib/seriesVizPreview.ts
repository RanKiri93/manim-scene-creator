import type { AxesItem, GraphSeriesVizItem, ItemId, SceneItem } from '@/types/scene';
import { effectiveStart } from '@/lib/time';

/** Max distinct n-indices drawn in preview (performance). */
export const MAX_SERIES_N_SPAN = 500;

export interface SeriesVizGhostLayer {
  points: number[];
  opacity: number;
}

export interface SeriesVizDrawSpec {
  ghosts: SeriesVizGhostLayer[];
  mainLine: number[];
  head?: { lx: number; ly: number };
  limitLineY?: number;
  strokeColor: string;
  headColor: string;
  strokeWidth: number;
  showHeadDot: boolean;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function applyEasing(u: number, easing: GraphSeriesVizItem['nEasing']): number {
  const t = clamp(u, 0, 1);
  switch (easing) {
    case 'ease_out':
      return 1 - (1 - t) * (1 - t);
    case 'ease_in_out':
      return t * t * (3 - 2 * t);
    default:
      return t;
  }
}

function evalAn(jsExpr: string, n: number): number | null {
  try {
    const v = new Function('n', `return (${jsExpr})`)(n) as number;
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function evalTermKx(jsExpr: string, k: number, x: number): number | null {
  try {
    const v = new Function('k', 'x', `return (${jsExpr})`)(k, x) as number;
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function effectiveNBounds(item: GraphSeriesVizItem): { nLo: number; nHi: number } {
  const nMin = Math.round(item.nMin);
  const nMax = Math.round(item.nMax);
  const lo = Math.min(nMin, nMax);
  const hi = Math.max(nMin, nMax);
  const span = hi - lo + 1;
  if (span <= MAX_SERIES_N_SPAN) return { nLo: lo, nHi: hi };
  return { nLo: lo, nHi: lo + MAX_SERIES_N_SPAN - 1 };
}

function nProgress(
  item: GraphSeriesVizItem,
  localT: number,
): { nFloat: number; nDisc: number } {
  const dur = Math.max(item.duration, 1e-6);
  const u = clamp(localT / dur, 0, 1);
  const uE = applyEasing(u, item.nEasing);
  const { nLo, nHi } = effectiveNBounds(item);
  const span = Math.max(nHi - nLo, 1e-9);
  const nFloat = nLo + uE * span;
  const nDisc = clamp(Math.floor(nFloat + 1e-9), nLo, nHi);
  return { nFloat, nDisc };
}

function valueAtIndexSequence(
  item: GraphSeriesVizItem,
  i: number,
  cache: Map<number, number | null>,
): number | null {
  if (cache.has(i)) return cache.get(i)!;
  const v = evalAn(item.jsExpr, i);
  cache.set(i, v);
  return v;
}

function partialSumUpTo(
  item: GraphSeriesVizItem,
  iEnd: number,
  nLo: number,
  cache: Map<number, number | null>,
): number | null {
  let s = 0;
  for (let i = nLo; i <= iEnd; i++) {
    const a = valueAtIndexSequence(item, i, cache);
    if (a === null) return null;
    s += a;
  }
  return s;
}

function buildDiscretePolyline(
  item: GraphSeriesVizItem,
  nEnd: number,
  toLocal: (gx: number, gy: number) => { lx: number; ly: number },
  cache: Map<number, number | null>,
): number[] {
  const { nLo, nHi } = effectiveNBounds(item);
  const end = clamp(nEnd, nLo, nHi);
  const pts: number[] = [];
  if (item.vizMode === 'sequence' || item.vizMode === 'series') {
    for (let i = nLo; i <= end; i++) {
      let y: number | null;
      if (item.vizMode === 'sequence') {
        y = valueAtIndexSequence(item, i, cache);
      } else {
        y = partialSumUpTo(item, i, nLo, cache);
      }
      if (y === null) continue;
      const { lx, ly } = toLocal(i, y);
      pts.push(lx, ly);
    }
  }
  return pts;
}

function partialPlotPoints(
  item: GraphSeriesVizItem,
  axes: AxesItem,
  nEnd: number,
  toLocal: (gx: number, gy: number) => { lx: number; ly: number },
): number[] {
  const [xMin, xMax] = axes.xRange;
  const { nLo, nHi } = effectiveNBounds(item);
  const end = clamp(Math.floor(nEnd + 1e-9), nLo, nHi);
  const steps = 200;
  const pts: number[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = xMin + t * (xMax - xMin);
    let sum = 0;
    let ok = true;
    for (let k = nLo; k <= end; k++) {
      const term = evalTermKx(item.jsExpr, k, x);
      if (term === null) {
        ok = false;
        break;
      }
      sum += term;
    }
    if (!ok) continue;
    const { lx, ly } = toLocal(x, sum);
    pts.push(lx, ly);
  }
  return pts;
}

function headPointSequenceSeries(
  item: GraphSeriesVizItem,
  nFloat: number,
  nDisc: number,
  toLocal: (gx: number, gy: number) => { lx: number; ly: number },
  cache: Map<number, number | null>,
): { lx: number; ly: number } | undefined {
  const { nLo, nHi } = effectiveNBounds(item);
  if (item.nMapping === 'linear_discrete') {
    let y: number | null;
    if (item.vizMode === 'sequence') {
      y = valueAtIndexSequence(item, nDisc, cache);
    } else {
      y = partialSumUpTo(item, nDisc, nLo, cache);
    }
    if (y === null) return undefined;
    return toLocal(nDisc, y);
  }
  const nf = clamp(nFloat, nLo, nHi);
  const i0 = clamp(Math.floor(nf), nLo, nHi);
  const i1 = clamp(Math.min(i0 + 1, nHi), nLo, nHi);
  const frac = nf - i0;
  let y0: number | null;
  let y1: number | null;
  if (item.vizMode === 'sequence') {
    y0 = valueAtIndexSequence(item, i0, cache);
    y1 = valueAtIndexSequence(item, i1, cache);
  } else {
    y0 = partialSumUpTo(item, i0, nLo, cache);
    y1 = partialSumUpTo(item, i1, nLo, cache);
  }
  if (y0 === null || y1 === null) return undefined;
  const y = y0 + frac * (y1 - y0);
  const gx = i0 + frac * (i1 - i0);
  return toLocal(gx, y);
}

function headPointPartialPlot(
  item: GraphSeriesVizItem,
  axes: AxesItem,
  nFloat: number,
  nDisc: number,
  toLocal: (gx: number, gy: number) => { lx: number; ly: number },
): { lx: number; ly: number } | undefined {
  const [xMin, xMax] = axes.xRange;
  const xHead = 0.5 * (xMin + xMax);
  const { nLo, nHi } = effectiveNBounds(item);
  if (item.nMapping === 'linear_discrete') {
    let sum = 0;
    for (let k = nLo; k <= nDisc; k++) {
      const term = evalTermKx(item.jsExpr, k, xHead);
      if (term === null) return undefined;
      sum += term;
    }
    return toLocal(xHead, sum);
  }
  const nf = clamp(nFloat, nLo, nHi);
  const i0 = clamp(Math.floor(nf), nLo, nHi);
  const i1 = clamp(Math.min(i0 + 1, nHi), nLo, nHi);
  const frac = nf - i0;
  let s0 = 0;
  let s1 = 0;
  for (let k = nLo; k <= i0; k++) {
    const term = evalTermKx(item.jsExpr, k, xHead);
    if (term === null) return undefined;
    s0 += term;
  }
  for (let k = nLo; k <= i1; k++) {
    const term = evalTermKx(item.jsExpr, k, xHead);
    if (term === null) return undefined;
    s1 += term;
  }
  const y = s0 + frac * (s1 - s0);
  return toLocal(xHead, y);
}

export function buildSeriesVizDrawSpec(
  item: GraphSeriesVizItem,
  axes: AxesItem,
  time: number,
  items: Map<ItemId, SceneItem>,
  toLocal: (gx: number, gy: number) => { lx: number; ly: number },
): SeriesVizDrawSpec | null {
  const t0 = effectiveStart(item, items);
  const localT = time - t0;
  if (localT < 0 || localT > item.duration) return null;

  const { nFloat, nDisc } = nProgress(item, localT);
  const { nLo } = effectiveNBounds(item);
  const cache = new Map<number, number | null>();

  const ghosts: SeriesVizGhostLayer[] = [];
  const gc = Math.max(0, Math.min(48, Math.floor(item.ghostCount)));
  const oMin = clamp(item.ghostOpacityMin, 0, 1);
  const oMax = clamp(item.ghostOpacityMax, 0, 1);

  for (let g = gc; g >= 1; g--) {
    const nGhost = nDisc - g;
    if (nGhost < nLo) continue;
    const alpha =
      gc <= 1 ? oMax : oMin + ((oMax - oMin) * (gc - g)) / Math.max(1, gc - 1);
    let pts: number[];
    if (item.vizMode === 'partialPlot') {
      pts = partialPlotPoints(item, axes, nGhost, toLocal);
    } else {
      pts = buildDiscretePolyline(item, nGhost, toLocal, cache);
    }
    if (pts.length >= 4) {
      ghosts.push({ points: pts, opacity: alpha });
    }
  }

  let mainLine: number[];
  if (item.vizMode === 'partialPlot') {
    mainLine = partialPlotPoints(item, axes, nDisc, toLocal);
  } else {
    mainLine = buildDiscretePolyline(item, nDisc, toLocal, cache);
  }

  let head: { lx: number; ly: number } | undefined;
  if (item.showHeadDot) {
    if (item.vizMode === 'partialPlot') {
      head = headPointPartialPlot(item, axes, nFloat, nDisc, toLocal);
    } else {
      head = headPointSequenceSeries(item, nFloat, nDisc, toLocal, cache);
    }
  }

  const limitLineY =
    item.limitY !== null && Number.isFinite(item.limitY) ? item.limitY : undefined;

  return {
    ghosts,
    mainLine,
    head,
    limitLineY,
    strokeColor: item.strokeColor,
    headColor: item.headColor,
    strokeWidth: Math.max(0.5, item.strokeWidth),
    showHeadDot: item.showHeadDot,
  };
}
