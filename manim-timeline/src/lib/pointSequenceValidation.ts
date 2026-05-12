import type { AxesItem, GraphPointSequenceItem, ItemId, SceneItem } from '@/types/scene';
import { pointSequenceIndices } from '@/types/scene';

/** Reuse function-series span cap for indexed sequences. */
export const MAX_POINT_SEQUENCE_SPAN = 500;

export interface PointSequenceValidation {
  topLevelError: string | null;
  perNErrors: Record<string, string>;
}

function compileX(jsExpr: string): ((n: number) => number) | string {
  try {
    return new Function(
      'n',
      `"use strict"; return (${jsExpr});`,
    ) as (n: number) => number;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `x expression: syntax error: ${msg}`;
  }
}

function compileY(jsExpr: string): ((n: number) => number) | string {
  try {
    return new Function(
      'n',
      `"use strict"; return (${jsExpr});`,
    ) as (n: number) => number;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `y expression: syntax error: ${msg}`;
  }
}

/**
 * Validate a point sequence: separate x(n), y(n) in JS; axes must exist.
 */
export function validatePointSequence(
  item: GraphPointSequenceItem,
  itemsMap: Map<ItemId, SceneItem>,
): PointSequenceValidation {
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
  if (span > MAX_POINT_SEQUENCE_SPAN) {
    return {
      topLevelError: `Range too large: ${span} points exceeds maximum of ${MAX_POINT_SEQUENCE_SPAN}.`,
      perNErrors,
    };
  }

  const ax = itemsMap.get(item.axesId);
  if (!ax || ax.kind !== 'axes') {
    return {
      topLevelError: 'Point sequence must reference a valid axes clip.',
      perNErrors,
    };
  }

  const fx = compileX(item.jsXExpr);
  if (typeof fx === 'string') {
    return { topLevelError: fx, perNErrors };
  }
  const fy = compileY(item.jsYExpr);
  if (typeof fy === 'string') {
    return { topLevelError: fy, perNErrors };
  }

  const axes = ax as AxesItem;
  const xLo = Math.min(axes.xRange[0], axes.xRange[1]);
  const xHi = Math.max(axes.xRange[0], axes.xRange[1]);
  const yLo = Math.min(axes.yRange[0], axes.yRange[1]);
  const yHi = Math.max(axes.yRange[0], axes.yRange[1]);

  for (const n of pointSequenceIndices(item)) {
    let xv: number;
    let yv: number;
    try {
      xv = fx(n);
      yv = fy(n);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      perNErrors[String(n)] = `Throws: ${msg}`;
      continue;
    }
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) {
      perNErrors[String(n)] = 'Non-finite coordinates (NaN / Infinity).';
      continue;
    }
    if (xv < xLo || xv > xHi || yv < yLo || yv > yHi) {
      perNErrors[String(n)] =
        `Point (${xv}, ${yv}) is outside axes domain x∈[${xLo}, ${xHi}], y∈[${yLo}, ${yHi}].`;
    }
  }

  return { topLevelError: null, perNErrors };
}
