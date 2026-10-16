import type { AudioTrackItem, GraphAreaCurveSource, GraphAreaItem, ItemId, RiemannRule, SceneItem } from '@/types/scene';
import { manimSmoothProgress, previewRunTime } from '@/lib/visualPlaybackPreview';
import { effectiveStart } from '@/lib/time';

/** Most rectangles one count may have (export draws each one as a polygon). */
export const RIEMANN_MAX_COUNT = 200;

export interface RiemannRect {
  /** Left and right edge in graph x. */
  x0: number;
  x1: number;
  /** Signed height (graph y) of the rectangle, from y = 0. */
  h: number;
}

/** Where the rectangle takes its height, as a share of its width (Manim: left / center / right). */
export function riemannSampleShare(rule: RiemannRule): number {
  return rule === 'left' ? 0 : rule === 'right' ? 1 : 0.5;
}

/** `n` equal rectangles on [xMin, xMax]; heights from `f` at the rule's sample point. */
export function riemannRects(f: (x: number) => number, xMin: number, xMax: number, n: number, rule: RiemannRule): RiemannRect[] {
  const count = Math.max(1, Math.min(RIEMANN_MAX_COUNT, Math.round(n)));
  const dx = (xMax - xMin) / count;
  const share = riemannSampleShare(rule);
  const out: RiemannRect[] = [];
  for (let i = 0; i < count; i++) {
    const x0 = xMin + i * dx;
    const x1 = i === count - 1 ? xMax : xMin + (i + 1) * dx;
    out.push({ x0, x1, h: f(x0 + share * (x1 - x0)) });
  }
  return out;
}

/** Signed sum of the rectangles' areas. */
export function riemannSum(rects: readonly RiemannRect[]): number {
  return rects.reduce((s, r) => s + r.h * (r.x1 - r.x0), 0);
}

/** JavaScript function of a curve source (plot or expression), or null when it cannot be built. */
export function curveSourceFunction(src: GraphAreaCurveSource, items: ReadonlyMap<ItemId, SceneItem>): ((x: number) => number) | null {
  let expr: string | undefined;
  if (src.sourceKind === 'plot') {
    const p = items.get(src.plotId);
    expr = p?.kind === 'graphPlot' ? p.fn.jsExpr : undefined;
  } else expr = src.jsExpr;
  if (!expr?.trim()) return null;
  try {
    const f = new Function('x', `"use strict"; return (${expr});`) as (x: number) => number;
    return (x) => {
      try {
        const y = Number(f(x));
        return Number.isFinite(y) ? y : 0;
      } catch {
        return 0;
      }
    };
  } catch {
    return null;
  }
}

export type RiemannMode = Extract<GraphAreaItem['mode'], { areaKind: 'riemann' }>;

/**
 * What a Riemann area shows at `time`. The clip's run time is split evenly between the counts:
 * the first fades in over its share, then each count morphs into the next over its share
 * (export: `FadeIn`, then `ReplacementTransform`s, each with Manim's smooth easing). `from` is the
 * count being replaced (null while the first fades in); `progress` is the eased share done.
 */
export function riemannPhase(
  item: GraphAreaItem & { mode: RiemannMode },
  time: number,
  items: Map<ItemId, SceneItem>,
  audioItems?: AudioTrackItem[],
): { from: number | null; to: number; progress: number } | null {
  const k = Math.max(1, item.mode.counts.length);
  const t0 = effectiveStart(item, items);
  if (time < t0) return null;
  const run = item.visibleAtSceneStart ? 0 : previewRunTime(item, items, audioItems);
  if (!(run > 0) || !Number.isFinite(run)) return { from: null, to: k - 1, progress: 1 };
  const raw = ((time - t0) / run) * k;
  if (raw >= k) return { from: null, to: k - 1, progress: 1 };
  const i = Math.max(0, Math.floor(raw));
  return { from: i === 0 ? null : i - 1, to: i, progress: manimSmoothProgress(Math.max(0, Math.min(1, raw - i))) };
}

/** `#rgb` / `#rrggbb` with an alpha, for a fill whose stroke stays opaque (as in Manim). */
export function fillWithAlpha(hex: string, alpha: number): string {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return hex;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, alpha))})`;
}
