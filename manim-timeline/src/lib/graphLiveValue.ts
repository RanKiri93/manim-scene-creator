import type { AxesItem, GraphDotItem, GraphPlotItem, ItemId, SceneItem } from '@/types/scene';
import { evaluateGraphY, graphFollowClipsForDot } from '@/lib/graphMotion';

/** Step for numerical slopes, as a share of the plot's x domain (same in preview and export). */
export const PLOT_SLOPE_STEP = 1e-4;

export type DotPlotResult =
  | { plot: GraphPlotItem; axes: AxesItem; domain: [number, number]; error: null }
  | { error: string };

/**
 * The function plot a graph dot sits on: `explicitPlotId`, else the plot it is attached to, else
 * the one plot its Move-along-graph clips follow. Used for tangents and for `{slope}` values.
 */
export function dotFunctionPlot(
  dot: GraphDotItem,
  items: ReadonlyMap<ItemId, SceneItem>,
  explicitPlotId?: ItemId,
): DotPlotResult {
  const axes = items.get(dot.axesId);
  if (axes?.kind !== 'axes') return { error: `Graph dot "${dot.id}" has no axes.` };
  const attachment = dot.dot.attachment;
  let plotId = explicitPlotId;
  if (!plotId && attachment?.kind === 'function') plotId = attachment.graphPlotId;
  if (!plotId && attachment?.kind === 'parametric') {
    return { error: `Graph dot "${dot.id}" sits on a parametric curve; a slope needs a function plot.` };
  }
  if (!plotId) {
    const followed = [
      ...new Set(
        graphFollowClipsForDot([...items.values()], dot.id)
          .map(({ row }) => row.graphPlotId)
          .filter((id): id is ItemId => !!id),
      ),
    ];
    if (followed.length === 1) plotId = followed[0];
    else if (followed.length > 1) return { error: `Graph dot "${dot.id}" follows several plots; name the plot.` };
  }
  if (!plotId) return { error: `Graph dot "${dot.id}" is not on a function plot.` };
  const plot = items.get(plotId);
  if (plot?.kind !== 'graphPlot') return { error: `"${plotId}" is not a function plot.` };
  if (plot.axesId !== dot.axesId) return { error: `Plot "${plotId}" and dot "${dot.id}" use different axes.` };
  const [a, b] = plot.xDomain ?? [axes.xRange[0], axes.xRange[1]];
  return { plot, axes, domain: [Math.min(a, b), Math.max(a, b)], error: null };
}

/** The two x values a numerical slope at `x` uses (central step, clamped to the domain). */
export function slopeSamplePoints(x: number, domain: [number, number]): [number, number] {
  const [lo, hi] = domain;
  const h = Math.max(1e-9, (hi - lo) * PLOT_SLOPE_STEP);
  return [Math.max(lo, x - h), Math.min(hi, x + h)];
}

/** dy/dx of the plot at `x` in graph units, or null where the plot has no slope. */
export function plotSlopeAt(plot: GraphPlotItem, x: number, domain: [number, number]): number | null {
  const [x0, x1] = slopeSamplePoints(x, domain);
  if (!(x1 > x0)) return null;
  try {
    const s = (evaluateGraphY(plot, x1) - evaluateGraphY(plot, x0)) / (x1 - x0);
    return Number.isFinite(s) ? s : null;
  } catch {
    return null;
  }
}

/** Values a live label template may show. */
export const LIVE_VALUE_KEYS = ['x', 'y', 'slope'] as const;
export type LiveValueKey = (typeof LIVE_VALUE_KEYS)[number];

export type LiveValuePart = { kind: 'text'; text: string } | { kind: 'value'; key: LiveValueKey };

/**
 * Split a template such as `"$f(x) = $ {y}"` into fixed text and `{x}` / `{y}` / `{slope}` values.
 * Unknown `{…}` names are reported in `unknown`.
 */
export function parseLiveValueTemplate(template: string): { parts: LiveValuePart[]; unknown: string[] } {
  const parts: LiveValuePart[] = [];
  const unknown: string[] = [];
  let last = 0;
  // A brace right after a TeX command, `}`, `^`, `_` or `\` is TeX (`\text{slope}`, `\frac{1}{h}`, `x^{n}`).
  for (const m of template.matchAll(/(?<![A-Za-z\\}^_])\{\s*([A-Za-z]+)\s*\}/g)) {
    const key = m[1]!;
    if (!(LIVE_VALUE_KEYS as readonly string[]).includes(key)) {
      unknown.push(key);
      continue;
    }
    if (m.index! > last) parts.push({ kind: 'text', text: template.slice(last, m.index) });
    parts.push({ kind: 'value', key: key as LiveValueKey });
    last = m.index! + m[0].length;
  }
  if (last < template.length) parts.push({ kind: 'text', text: template.slice(last) });
  return { parts, unknown };
}

/** True when the template shows `{slope}` (the dot then needs a function plot). */
export function templateUsesSlope(template: string | undefined): boolean {
  return !!template && parseLiveValueTemplate(template).parts.some((p) => p.kind === 'value' && p.key === 'slope');
}

/**
 * Fixed text as the export typesets it: as written when it has `$` or Hebrew, otherwise as math
 * (so `f(x) =` comes out like a formula). Empty pieces are dropped.
 */
export function liveTemplateTexSource(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  return t.includes('$') || /[֐-׿]/.test(t) ? t : `$${t}$`;
}

/** Same rounding as the export (`_graph_fixed`: half away from zero, no "-0"). */
export function formatLiveNumber(value: number, precision: number): string {
  const p = Math.max(0, Math.min(6, Math.trunc(precision)));
  const factor = 10 ** p;
  const rounded = Math.round(Math.abs(value) * factor + 1e-9) / factor;
  const text = rounded.toFixed(p);
  return value < 0 && Number(text) !== 0 ? `-${text}` : text;
}

/** Preview text for a template: values formatted, `$` and `\text{…}` dropped from fixed text. */
export function formatLiveValueText(
  template: string,
  values: { x: number; y: number; slope: number | null },
  precision: number,
): string {
  return parseLiveValueTemplate(template)
    .parts.map((p) => {
      if (p.kind === 'text') return p.text.replace(/\\text\{([^}]*)\}/g, '$1').replace(/\$/g, '');
      const v = values[p.key];
      return v == null ? '?' : formatLiveNumber(v, precision);
    })
    .join('');
}

/** Slope for a dot's `{slope}` live value at graph x (null when the template has none or no plot). */
export function liveValueSlope(dot: GraphDotItem, x: number, items: ReadonlyMap<ItemId, SceneItem>): number | null {
  if (!dot.dot.showCoordinates || !templateUsesSlope(dot.dot.valueTemplate)) return null;
  const r = dotFunctionPlot(dot, items);
  return r.error != null ? null : plotSlopeAt(r.plot, x, r.domain);
}
