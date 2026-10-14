import type { AxesItem, GraphCurveItem, GraphDotItem, GraphPlotItem, ItemId, SceneItem, TargetAnimationItem } from '@/types/scene';
import { effectiveStart } from '@/lib/time';

export const GRAPH_MOTION_START_TOLERANCE = 1e-4;
export const GRAPH_MOTION_INTERVAL_SAMPLES = 128;
export const GRAPH_MOTION_DISCONTINUITY_JUMP = 10;
export interface GraphMotionResult { point: { x: number; y: number }; error: string | null; warnings: string[]; parameter?: number; parameterKind?: 'x' | 't' }
export interface ProjectionGuides { vertical: { x1: number; y1: number; x2: number; y2: number }; horizontal: { x1: number; y1: number; x2: number; y2: number } }
export interface GraphFollowSelection { dot: GraphDotItem | null; plot: GraphPlotItem | null; curve: GraphCurveItem | null; error: string | null }

/** Eligibility predicate shared by graph-follow row validation and timing. */
export function isGraphFollowTarget(item: SceneItem | undefined): item is GraphDotItem {
  return item?.kind === 'graphDot';
}

/** Latest required start among graph-follow dot rows, using the canonical timeline start resolver. */
export function graphFollowMinimumStartTime(clip: TargetAnimationItem, items: Map<ItemId, SceneItem>): number | null {
  if (clip.mode !== 'graphFollow') return null;
  const starts = clip.targets.flatMap((row) => {
    const target = items.get(row.targetId);
    return isGraphFollowTarget(target) ? [effectiveStart(target, items)] : [];
  });
  return starts.length > 0 ? Math.max(...starts) : null;
}

export function graphFollowStartTimeError(clip: TargetAnimationItem, items: Map<ItemId, SceneItem>): string | null {
  const minimum = graphFollowMinimumStartTime(clip, items);
  return minimum != null && clip.startTime + 1e-6 < minimum
    ? `Move-along-graph clip cannot start before its graph dot appears (${minimum.toFixed(2)}s).`
    : null;
}

/** Select a unique valid dot/plot pair; never substitute a mismatched selected plot. */
export function resolveGraphFollowSelection(items: ReadonlyMap<ItemId, SceneItem>, selectedIds: ReadonlySet<ItemId>): GraphFollowSelection {
  const values = [...items.values()];
  const selected = [...selectedIds].map((id) => items.get(id)).filter((item): item is SceneItem => item != null);
  const selectedDots = selected.filter((item): item is GraphDotItem => item.kind === 'graphDot');
  const selectedPlots = selected.filter((item): item is GraphPlotItem => item.kind === 'graphPlot');
  if (selectedDots.length > 1) return { dot: null, plot: null, curve: null, error: 'Select exactly one graph dot for Move along graph.' };
  if (selectedPlots.length > 1) return { dot: null, plot: null, curve: null, error: 'Select exactly one source plot for Move along graph.' };
  const allDots = values.filter((item): item is GraphDotItem => item.kind === 'graphDot');
  const dot = selectedDots[0] ?? (selectedPlots[0]
    ? (() => { const matching = allDots.filter((candidate) => candidate.axesId === selectedPlots[0]!.axesId); return matching.length === 1 ? matching[0]! : null; })()
    : selectedIds.size === 0 && allDots.length === 1 ? allDots[0]! : null);
  if (!dot) return { dot: null, plot: null, curve: null, error: 'Select a graph dot and a compatible function plot.' };
  if (dot.dot.attachment?.kind === 'function') {
    const source = items.get(dot.dot.attachment.graphPlotId);
    if (source?.kind !== 'graphPlot' || source.axesId !== dot.axesId) return { dot: null, plot: null, curve: null, error: 'Attached function source is missing or uses different axes.' };
    if (selectedPlots.length === 1 && selectedPlots[0]!.id !== source.id) return { dot: null, plot: null, curve: null, error: 'This attached dot follows its own function source; remove the incompatible plot selection.' };
    return { dot, plot: source, curve: null, error: null };
  }
  if (dot.dot.attachment?.kind === 'parametric') {
    const source = items.get(dot.dot.attachment.graphCurveId);
    if (source?.kind !== 'graphCurve' || source.axesId !== dot.axesId) return { dot: null, plot: null, curve: null, error: 'Attached parametric source is missing or uses different axes.' };
    if (selectedPlots.length > 0) return { dot: null, plot: null, curve: null, error: 'This attached dot follows its parametric curve, not a function plot.' };
    return { dot, plot: null, curve: source, error: null };
  }
  if (selectedPlots.length === 1 && selectedPlots[0]!.axesId !== dot.axesId) {
    return { dot: null, plot: null, curve: null, error: 'The selected plot and graph dot use different axes. Select a same-axes plot.' };
  }
  const matchingPlots = values.filter((item): item is GraphPlotItem => item.kind === 'graphPlot' && item.axesId === dot.axesId);
  const plot = selectedPlots[0] ?? (matchingPlots.length === 1 ? matchingPlots[0]! : null);
  if (!plot) return { dot: null, plot: null, curve: null, error: matchingPlots.length === 0 ? 'No function plot exists on the graph dot’s axes.' : 'Choose one of the multiple function plots on the graph dot’s axes.' };
  return { dot, plot, curve: null, error: null };
}

/** Evaluate the project's JavaScript graph expression at x. Expressions are authored by the user. */
export function evaluateGraphY(plot: GraphPlotItem, x: number): number {
  const fn = new Function('x', `"use strict"; return (${plot.fn.jsExpr});`) as (x: number) => number;
  return fn(x);
}

function evaluateCurvePoint(curve: GraphCurveItem, t: number): { x: number; y: number } {
  const xFn = new Function('t', `"use strict"; return (${curve.curve.jsXExpr});`) as (t: number) => number;
  const yFn = new Function('t', `"use strict"; return (${curve.curve.jsYExpr});`) as (t: number) => number;
  return { x: xFn(t), y: yFn(t) };
}

export function resolveAttachedGraphDot(dot: GraphDotItem, items: readonly SceneItem[]): GraphMotionResult {
  const attachment = dot.dot.attachment ?? { kind: 'free' as const };
  if (attachment.kind === 'free') return { point: { x: dot.dot.dx, y: dot.dot.dy }, error: null, warnings: [], parameter: dot.dot.dx, parameterKind: 'x' };
  if (attachment.kind === 'function') {
    const plot = items.find((it): it is GraphPlotItem => it.kind === 'graphPlot' && it.id === attachment.graphPlotId);
    if (!plot || plot.axesId !== dot.axesId) return { point: { x: dot.dot.dx, y: dot.dot.dy }, error: 'Attached function plot is missing or uses different axes.', warnings: [] };
    if (!Number.isFinite(attachment.x)) return { point: { x: dot.dot.dx, y: dot.dot.dy }, error: 'Attached function x must be finite.', warnings: [] };
    const axes = items.find((it): it is AxesItem => it.kind === 'axes' && it.id === dot.axesId);
    const domain = plot.xDomain ?? (axes ? [axes.xRange[0], axes.xRange[1]] as [number, number] : null);
    if (domain && (attachment.x < Math.min(...domain) || attachment.x > Math.max(...domain))) return { point: { x: dot.dot.dx, y: dot.dot.dy }, error: `Attached x is outside plot ${plot.id}'s domain.`, warnings: [] };
    try {
      const point = { x: attachment.x, y: evaluateGraphY(plot, attachment.x) };
      return Number.isFinite(point.y) ? { point, error: null, warnings: [], parameter: attachment.x, parameterKind: 'x' } : { point: { x: dot.dot.dx, y: dot.dot.dy }, error: `Plot ${plot.id} is undefined at the attached x.`, warnings: [] };
    } catch { return { point: { x: dot.dot.dx, y: dot.dot.dy }, error: `Could not evaluate plot ${plot.id}.`, warnings: [] }; }
  }
  const curve = items.find((it): it is GraphCurveItem => it.kind === 'graphCurve' && it.id === attachment.graphCurveId);
  if (!curve || curve.axesId !== dot.axesId) return { point: { x: dot.dot.dx, y: dot.dot.dy }, error: 'Attached parametric curve is missing or uses different axes.', warnings: [] };
  if (!Number.isFinite(attachment.t)) return { point: { x: dot.dot.dx, y: dot.dot.dy }, error: 'Attached curve t must be finite.', warnings: [] };
  if (attachment.t < Math.min(...curve.tDomain) || attachment.t > Math.max(...curve.tDomain)) return { point: { x: dot.dot.dx, y: dot.dot.dy }, error: `Attached t is outside curve ${curve.id}'s domain.`, warnings: [] };
  try {
    const point = evaluateCurvePoint(curve, attachment.t);
    return Number.isFinite(point.x) && Number.isFinite(point.y) ? { point, error: null, warnings: [], parameter: attachment.t, parameterKind: 't' } : { point: { x: dot.dot.dx, y: dot.dot.dy }, error: `Curve ${curve.id} is undefined at the attached t.`, warnings: [] };
  } catch { return { point: { x: dot.dot.dx, y: dot.dot.dy }, error: `Could not evaluate curve ${curve.id}.`, warnings: [] }; }
}

export function graphFollowClipsForDot(items: readonly SceneItem[], dotId: ItemId): { clip: TargetAnimationItem; row: NonNullable<TargetAnimationItem['targets'][number]> }[] {
  return items.filter((item): item is TargetAnimationItem => item.kind === 'target_animation' && item.mode === 'graphFollow')
    .flatMap((clip) => clip.targets.filter((row) => row.targetId === dotId).map((row) => ({ clip, row })))
    .sort((a, b) => a.clip.startTime - b.clip.startTime || a.clip.id.localeCompare(b.clip.id));
}

export function resolveGraphDotPosition(args: { dot: GraphDotItem; items: readonly SceneItem[]; time: number }): GraphMotionResult {
  const { dot, items, time } = args;
  const resolvedSource = resolveAttachedGraphDot(dot, items);
  let point = resolvedSource.point;
  const warnings: string[] = [];
  if (resolvedSource.error) return resolvedSource;
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const startError = graphFollowClipsForDot(items, dot.id).map(({ clip }) => graphFollowStartTimeError(clip, itemMap)).find((error) => error != null);
  if (startError) return { point, error: startError, warnings };
  const conflicts = graphMotionConflicts(dot.id, items);
  if (conflicts.length) return { point, error: conflicts[0]!, warnings: conflicts };
  let parameter = resolvedSource.parameter ?? point.x;
  const parameterKind = resolvedSource.parameterKind ?? 'x';
  for (const { clip, row } of graphFollowClipsForDot(items, dot.id)) {
    if (clip.startTime > time) break;
    const axes = items.find((i): i is AxesItem => i.kind === 'axes' && i.id === dot.axesId);
    if (!axes) return { point, error: `Graph-follow clip ${clip.id} needs the dot's axes.`, warnings };
    const attachment = dot.dot.attachment ?? { kind: 'free' as const };
    const functionMode = attachment.kind === 'function' || attachment.kind === 'free';
    const plotId = attachment.kind === 'function' ? attachment.graphPlotId : row.graphPlotId;
    if (attachment.kind === 'free' && (row.graphCurveId || row.targetT != null)) return { point, error: 'Free dots cannot use parametric graph-follow; attach the dot to a parametric curve first.', warnings };
    const plot = functionMode ? items.find((i): i is GraphPlotItem => i.kind === 'graphPlot' && i.id === plotId) : null;
    const curveId = attachment.kind === 'parametric' ? attachment.graphCurveId : null;
    const curve = curveId ? items.find((i): i is GraphCurveItem => i.kind === 'graphCurve' && i.id === curveId) : null;
    if (functionMode && (!plot || plot.axesId !== dot.axesId)) return { point, error: `Graph-follow clip ${clip.id} needs a same-axes function plot.`, warnings };
    if (attachment.kind === 'function' && row.graphPlotId && row.graphPlotId !== attachment.graphPlotId) return { point, error: `Graph-follow clip ${clip.id} source does not match its function-attached dot.`, warnings };
    if (attachment.kind === 'parametric' && !curve) return { point, error: `Attached curve for graph-follow clip ${clip.id} is missing.`, warnings };
    const target = functionMode ? row.targetX : row.targetT;
    if (!Number.isFinite(target)) return { point, error: `Graph-follow clip ${clip.id} has an invalid ${functionMode ? 'target x' : 'target t'}.`, warnings };
    const graphAxes = items.find((item): item is AxesItem => item.kind === 'axes' && item.id === dot.axesId);
    const domain = functionMode ? (plot!.xDomain ?? (graphAxes ? [graphAxes.xRange[0], graphAxes.xRange[1]] as [number, number] : null)) : curve!.tDomain;
    const low = Math.min(parameter, target!);
    const high = Math.max(parameter, target!);
    if (domain && (low < Math.min(...domain) || high > Math.max(...domain))) return { point, error: `Motion leaves ${functionMode ? 'plot' : 'curve'} source domain.`, warnings };
    if (functionMode && attachment.kind === 'free') {
      let startY: number;
      try { startY = evaluateGraphY(plot!, point.x); } catch { return { point, error: `Could not evaluate plot ${plot!.id} at the start point.`, warnings }; }
      if (Math.abs(startY - point.y) > GRAPH_MOTION_START_TOLERANCE) return { point, error: `Dot is not on plot ${plot!.id} at clip start.`, warnings };
    }
    // Best-effort numerical check, not a proof that no discontinuity exists.
    let previous = point;
    for (let i = 1; i <= GRAPH_MOTION_INTERVAL_SAMPLES; i++) {
      const sampleParam = parameter + ((target! - parameter) * i) / GRAPH_MOTION_INTERVAL_SAMPLES;
      let sample: { x: number; y: number };
      try { sample = functionMode ? { x: sampleParam, y: evaluateGraphY(plot!, sampleParam) } : evaluateCurvePoint(curve!, sampleParam); }
      catch { return { point, error: `Source is undefined during graph-follow clip ${clip.id}.`, warnings }; }
      if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y)) return { point, error: `Source is undefined during graph-follow clip ${clip.id}.`, warnings };
      if (Math.hypot(sample.x - previous.x, sample.y - previous.y) > GRAPH_MOTION_DISCONTINUITY_JUMP) return { point, error: `Detected a discontinuity during graph-follow clip ${clip.id}.`, warnings };
      previous = sample;
    }
    const progress = clip.duration <= 0 ? 1 : Math.max(0, Math.min(1, (time - clip.startTime) / clip.duration));
    const eased = row.easing === 'linear' ? progress : progress * progress * (3 - 2 * progress);
    parameter += (target! - parameter) * eased;
    try { point = functionMode ? { x: parameter, y: evaluateGraphY(plot!, parameter) } : evaluateCurvePoint(curve!, parameter); }
    catch { return { point, error: `Source is undefined during graph-follow clip ${clip.id}.`, warnings }; }
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return { point, error: `Source is undefined during graph-follow clip ${clip.id}.`, warnings };
  }
  return { point, error: null, warnings, parameter, parameterKind };
}

/** Deterministically report overlapping positional writers for this point. */
export function graphMotionConflicts(dotId: ItemId, items: readonly SceneItem[]): string[] {
  const writers = items.filter((it): it is TargetAnimationItem => it.kind === 'target_animation' && ['graphFollow', 'move', 'path'].includes(it.mode) && it.targets.some((row) => row.targetId === dotId))
    .sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
  const errors: string[] = [];
  for (let i = 0; i < writers.length; i++) for (let j = i + 1; j < writers.length; j++) {
    const a = writers[i]!, b = writers[j]!;
    if (b.startTime >= a.startTime + a.duration) break;
    errors.push(`Position animations ${a.id} and ${b.id} overlap for graph dot ${dotId}.`);
  }
  return errors;
}

/** Graph-space projection endpoints, falling back to visible range edges when zero is absent. */
export function graphProjectionGuides(point: { x: number; y: number }, axes: AxesItem): ProjectionGuides {
  const [xmin, xmax] = axes.xRange; const [ymin, ymax] = axes.yRange;
  const gx = xmin <= 0 && xmax >= 0 ? 0 : Math.abs(point.x - xmin) <= Math.abs(point.x - xmax) ? xmin : xmax;
  const gy = ymin <= 0 && ymax >= 0 ? 0 : Math.abs(point.y - ymin) <= Math.abs(point.y - ymax) ? ymin : ymax;
  return { vertical: { x1: point.x, y1: point.y, x2: point.x, y2: gy }, horizontal: { x1: point.x, y1: point.y, x2: gx, y2: point.y } };
}
