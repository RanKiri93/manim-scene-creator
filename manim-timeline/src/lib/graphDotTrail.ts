import type { GraphCurveItem, GraphDotItem, GraphDotTrace, GraphPlotItem, ItemId, SceneItem } from '@/types/scene';
import { graphFollowClipsForDot, resolveAttachedGraphDot, resolveGraphDotPosition } from '@/lib/graphMotion';
import { effectiveStart } from '@/lib/time';

/** Manim stroke widths are in 0.01 scene units (same factor as the axes preview). */
export const TRAIL_STROKE_UNITS_PER_WIDTH = 0.01;
/** Preview samples per second of trail (export records every frame). */
export const TRAIL_SAMPLES_PER_SECOND = 60;
export const TRAIL_MAX_SAMPLES = 600;
export const DEFAULT_TRAIL_WIDTH = 3;

/** One trail point in graph coordinates; `age` = seconds before the time asked. */
export interface TrailPoint {
  x: number;
  y: number;
  age: number;
}

/** Trace settings with defaults filled in (`color` = the dot's colour). */
export function effectiveTrace(dot: GraphDotItem['dot']): Required<Omit<GraphDotTrace, 'fadeSeconds'>> & { fadeSeconds: number | null } | null {
  const t = dot.trace;
  if (!t) return null;
  const fade = t.fadeSeconds;
  return {
    color: t.color || dot.color,
    width: Number.isFinite(t.width) && t.width! > 0 ? t.width! : DEFAULT_TRAIL_WIDTH,
    fadeSeconds: fade != null && Number.isFinite(fade) && fade > 0 ? fade : null,
  };
}

const compiled = new Map<string, (v: number) => number>();
function fn(arg: string, expr: string): (v: number) => number {
  const key = `${arg}:${expr}`;
  let f = compiled.get(key);
  if (!f) {
    f = new Function(arg, `"use strict"; return (${expr});`) as (v: number) => number;
    compiled.set(key, f);
  }
  return f;
}

/**
 * Where a dot's trail runs at `time`: its graph positions from when it appears (or `fadeSeconds`
 * ago) up to now, following its attachment and Move-along-graph clips with the same easing as
 * `resolveGraphDotPosition`. Export draws the same with Manim's `TracedPath`.
 */
export function graphDotTrail(dot: GraphDotItem, items: ReadonlyMap<ItemId, SceneItem>, time: number): TrailPoint[] {
  const trace = effectiveTrace(dot.dot);
  if (!trace) return [];
  const all = [...items.values()];
  const start = effectiveStart(dot, items as Map<ItemId, SceneItem>);
  if (time < start) return [];
  if (resolveGraphDotPosition({ dot, items: all, time }).error) return [];
  const from = trace.fadeSeconds != null ? Math.max(start, time - trace.fadeSeconds) : start;

  const attachment = dot.dot.attachment ?? { kind: 'free' as const };
  const source = resolveAttachedGraphDot(dot, all);
  const p0 = source.parameter ?? source.point.x;
  const clips = graphFollowClipsForDot(all, dot.id);
  const curve =
    attachment.kind === 'parametric' ? (items.get(attachment.graphCurveId) as GraphCurveItem | undefined) : undefined;
  const plotFor = (plotId: ItemId | undefined) => {
    const p = plotId ? items.get(plotId) : undefined;
    return p?.kind === 'graphPlot' ? (p as GraphPlotItem) : undefined;
  };

  const pointAt = (t: number): { x: number; y: number } | null => {
    let p = p0;
    let plot = attachment.kind === 'function' ? plotFor(attachment.graphPlotId) : undefined;
    let moved = false;
    for (const { clip, row } of clips) {
      if (clip.startTime > t) break;
      const target = attachment.kind === 'parametric' ? row.targetT : row.targetX;
      if (target == null || !Number.isFinite(target)) return null;
      if (attachment.kind === 'free') plot = plotFor(row.graphPlotId);
      const progress = clip.duration <= 0 ? 1 : Math.max(0, Math.min(1, (t - clip.startTime) / clip.duration));
      const eased = row.easing === 'linear' ? progress : progress * progress * (3 - 2 * progress);
      p += (target - p) * eased;
      moved = true;
    }
    try {
      if (curve) return { x: fn('t', curve.curve.jsXExpr)(p), y: fn('t', curve.curve.jsYExpr)(p) };
      if (plot) return { x: p, y: fn('x', plot.fn.jsExpr)(p) };
      return moved ? null : { x: source.point.x, y: source.point.y };
    } catch {
      return null;
    }
  };

  const span = time - from;
  const n = Math.min(TRAIL_MAX_SAMPLES, Math.max(1, Math.ceil(span * TRAIL_SAMPLES_PER_SECOND)));
  const out: TrailPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = from + (span * i) / n;
    const q = pointAt(t);
    if (q && Number.isFinite(q.x) && Number.isFinite(q.y)) out.push({ ...q, age: time - t });
  }
  return out;
}
