import type {
  GraphFunctionSeriesItem,
  AxesItem,
  SceneItem,
  ItemId,
} from '@/types/scene';
import {
  functionSeriesIndices,
  resolveFunctionSeriesDisplayMode,
} from '@/types/scene';

/** Hard cap on the number of curves in one series. */
export const MAX_FUNCTION_SERIES_SPAN = 500;

/** Number of x-probe points used to decide whether a per-n expression is usable. */
const PROBE_POINTS = 16;

export interface FunctionSeriesValidation {
  /** Top-level error (syntax, range invalid, span too large). null when OK. */
  topLevelError: string | null;
  /** Per-n errors keyed by stringified n. Only entries with non-null errors are present. */
  perNErrors: Record<string, string>;
}

function compile(jsExpr: string): ((n: number, x: number) => number) | string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function(
      'n',
      'x',
      `"use strict"; return (${jsExpr});`,
    ) as (n: number, x: number) => number;
    return fn;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `Syntax error: ${msg}`;
  }
}

function probeXs(axes: AxesItem | undefined, item: GraphFunctionSeriesItem): number[] {
  let lo: number;
  let hi: number;
  if (item.xDomain) {
    lo = Math.min(item.xDomain[0], item.xDomain[1]);
    hi = Math.max(item.xDomain[0], item.xDomain[1]);
  } else if (axes) {
    lo = axes.xRange[0];
    hi = axes.xRange[1];
  } else {
    lo = -5;
    hi = 5;
  }
  if (!(hi > lo)) return [lo];
  const xs: number[] = [];
  for (let i = 0; i < PROBE_POINTS; i++) {
    const t = i / (PROBE_POINTS - 1);
    xs.push(lo + (hi - lo) * t);
  }
  return xs;
}

/**
 * Validate a function series.
 *
 * - Compilation failures → top-level syntax error.
 * - Range: n_min must be < n_max. Integer span must fit under MAX_FUNCTION_SERIES_SPAN.
 * - Per-n: record an error only if the function throws on every probe point or returns
 *   non-finite on every probe point (isolated singularities like 1/(x-n) are fine — the
 *   renderer silently skips non-finite sample points, matching graphPlot behavior).
 */
export function validateFunctionSeries(
  item: GraphFunctionSeriesItem,
  itemsMap: Map<ItemId, SceneItem>,
): FunctionSeriesValidation {
  const perNErrors: Record<string, string> = {};

  if (!Number.isFinite(item.nMin) || !Number.isFinite(item.nMax)) {
    return { topLevelError: 'n range must be finite numbers.', perNErrors };
  }
  if (Math.trunc(item.nMin) >= Math.trunc(item.nMax)) {
    return {
      topLevelError: 'n_min must be strictly less than n_max.',
      perNErrors,
    };
  }
  const span = Math.trunc(item.nMax) - Math.trunc(item.nMin) + 1;
  if (span > MAX_FUNCTION_SERIES_SPAN) {
    return {
      topLevelError: `Range too large: ${span} curves exceeds maximum of ${MAX_FUNCTION_SERIES_SPAN}.`,
      perNErrors,
    };
  }

  const fn = compile(item.jsExpr);
  if (typeof fn === 'string') {
    return { topLevelError: fn, perNErrors };
  }

  const axes = itemsMap.get(item.axesId);
  const axesItem = axes && axes.kind === 'axes' ? (axes as AxesItem) : undefined;
  const xs = probeXs(axesItem, item);

  const indices = functionSeriesIndices(item);
  const displayMode = resolveFunctionSeriesDisplayMode(item);

  if (displayMode === 'individual') {
    for (const n of indices) {
      let anyFinite = false;
      let threwEvery = true;
      for (const x of xs) {
        try {
          const y = fn(n, x);
          threwEvery = false;
          if (Number.isFinite(y)) {
            anyFinite = true;
            break;
          }
        } catch {
          // threw at this probe; keep threwEvery true unless another probe succeeds
        }
      }
      if (threwEvery) {
        perNErrors[String(n)] = 'Expression throws for every sampled x.';
      } else if (!anyFinite) {
        perNErrors[String(n)] =
          'Expression returns non-finite (NaN / Infinity) everywhere.';
      }
    }
    return { topLevelError: null, perNErrors };
  }

  // partialSum: walk the x-grid column-by-column and accumulate. A column that throws
  // or becomes non-finite at term m poisons every S_k for k >= m at that x. Flag k
  // only when *every* column is poisoned at that point — isolated singularities
  // (e.g. one x where a term blows up) are still fine, same as 'individual'.
  const acc = new Array<number>(xs.length).fill(0);
  const poisoned = new Array<boolean>(xs.length).fill(false);
  const threwAt = new Array<boolean>(xs.length).fill(false);
  for (const n of indices) {
    for (let i = 0; i < xs.length; i++) {
      if (poisoned[i]) continue;
      try {
        const term = fn(n, xs[i]!);
        if (!Number.isFinite(term)) {
          poisoned[i] = true;
          continue;
        }
        acc[i]! += term;
        if (!Number.isFinite(acc[i]!)) poisoned[i] = true;
      } catch {
        poisoned[i] = true;
        threwAt[i] = true;
      }
    }
    let anyGood = false;
    let allThrew = true;
    for (let i = 0; i < xs.length; i++) {
      if (!poisoned[i] && Number.isFinite(acc[i]!)) {
        anyGood = true;
        allThrew = false;
        break;
      }
      if (!threwAt[i]) allThrew = false;
    }
    if (allThrew) {
      perNErrors[String(n)] =
        'Partial sum throws for every sampled x (check earlier terms).';
    } else if (!anyGood) {
      perNErrors[String(n)] =
        'Partial sum is non-finite (NaN / Infinity) everywhere.';
    }
  }

  return { topLevelError: null, perNErrors };
}
