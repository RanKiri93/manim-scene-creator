import type { GraphAreaIntroStyle, GraphAreaItem, GraphAreaMode } from '@/types/scene';

/*
 * Graph-area entrances other than a fade: what part of the area shows at a given progress.
 * The canvas preview draws this; the exporter emits `_AreaReveal`, which computes the same
 * window in Python (keep `areaRevealWindow` and `graphAreaRevealSource` in step).
 */

export const GRAPH_AREA_INTRO_STYLES: readonly GraphAreaIntroStyle[] = ['fade_in', 'sweep_right', 'sweep_left', 'rise'];

/** Smallest share drawn at the very start, so the outline never degenerates to a line. */
export const AREA_REVEAL_MIN_SHARE = 1e-3;

/** Area kinds bounded by curves over [xMin, xMax]: the ones that can sweep or rise. */
export function areaCanReveal(mode: GraphAreaMode): mode is Extract<GraphAreaMode, { areaKind: 'underCurve' | 'betweenCurves' }> {
  return mode.areaKind === 'underCurve' || mode.areaKind === 'betweenCurves';
}

/** The entrance an area actually uses: sweeps and rise fall back to a fade for other shapes. */
export function effectiveAreaIntroStyle(item: GraphAreaItem): GraphAreaIntroStyle {
  const style = item.introStyle ?? 'fade_in';
  return style !== 'fade_in' && !areaCanReveal(item.mode) ? 'fade_in' : style;
}

/** The part of the area drawn at eased progress `p`: x from `lo` to `hi`, filled from the lower boundary to `k` of the way to the upper one. */
export interface AreaRevealWindow {
  lo: number;
  hi: number;
  k: number;
}

export function areaRevealWindow(style: GraphAreaIntroStyle, x0: number, x1: number, p: number): AreaRevealWindow {
  const a = Math.max(AREA_REVEAL_MIN_SHARE, Math.min(1, p));
  if (style === 'sweep_left') return { lo: x1 - (x1 - x0) * a, hi: x1, k: 1 };
  if (style === 'rise') return { lo: x0, hi: x1, k: a };
  if (style === 'sweep_right') return { lo: x0, hi: x0 + (x1 - x0) * a, k: 1 };
  return { lo: x0, hi: x1, k: 1 };
}
