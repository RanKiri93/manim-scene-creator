import { describe, expect, it } from 'vitest';
import { resolveGraphDotPosition, graphMotionConflicts, graphProjectionGuides, resolveGraphFollowSelection, graphFollowMinimumStartTime, graphFollowStartTimeError, isGraphFollowTarget } from '@/lib/graphMotion';
import type { AxesItem, GraphCurveItem, GraphDotItem, GraphPlotItem, SceneItem, TargetAnimationItem } from '@/types/scene';

const dot: GraphDotItem = { kind: 'graphDot', id: 'd', axesId: 'a', dot: { id: 'd', dx: 0, dy: 0, color: '#fff', radius: .1, label: '', labelDir: 'UP' }, label: '', layer: 0, startTime: 0, duration: 1, x: 0, y: 0, scale: 1, posSteps: [] };
const plot: GraphPlotItem = { kind: 'graphPlot', id: 'p', axesId: 'a', fn: { id: 'f', jsExpr: 'x*x', pyExpr: 'x**2', color: '#fff', label: '' }, xDomain: null, strokeWidth: 1, label: '', layer: 0, startTime: 0, duration: 1, x: 0, y: 0, scale: 1, posSteps: [] };
const axes: AxesItem = { kind: 'axes', id: 'a', xRange: [-2, 2, 1], yRange: [-2, 4, 1], xLabel: '', yLabel: '', includeNumbers: false, includeTip: false, scaleX: 1, scaleY: 1, label: '', layer: 0, startTime: 0, duration: 1, x: 0, y: 0, scale: 1, posSteps: [] };
const clip: TargetAnimationItem = { kind: 'target_animation', id: 'c', label: '', layer: 0, mode: 'graphFollow', startTime: 1, duration: 2, targets: [{ targetId: 'd', graphPlotId: 'p', targetX: 2, easing: 'linear' }] };
describe('graphFollow resolver', () => {
  it('rejects an explicitly selected plot on different axes and allows the compatible pair', () => {
    const wrongAxes = { ...plot, id: 'other-plot', axesId: 'other-axes' };
    const items = new Map<string, SceneItem>([[dot.id, dot], [plot.id, plot], [wrongAxes.id, wrongAxes]]);
    expect(resolveGraphFollowSelection(items, new Set([dot.id, wrongAxes.id])).error).toMatch(/different axes/);
    expect(resolveGraphFollowSelection(items, new Set([dot.id, plot.id]))).toMatchObject({ dot, plot, error: null });
  });
  it('recomputes function attachments when source expressions change', () => {
    const attached = { ...dot, dot: { ...dot.dot, attachment: { kind: 'function' as const, graphPlotId: 'p', x: 1 } } };
    expect(resolveGraphDotPosition({ dot: attached, items: [attached, axes, plot], time: 0 }).point).toEqual({ x: 1, y: 1 });
    const changed = { ...plot, fn: { ...plot.fn, jsExpr: '2*x' } };
    expect(resolveGraphDotPosition({ dot: attached, items: [attached, axes, changed], time: 0 }).point).toEqual({ x: 1, y: 2 });
  });
  it('animates attached parametric dots in t and rejects free-dot parametric rows', () => {
    const curve: GraphCurveItem = { kind: 'graphCurve', id: 'c', axesId: 'a', curve: { id: 'cdata', jsXExpr: 'Math.cos(t)', jsYExpr: 'Math.sin(t)', pyXExpr: 'np.cos(t)', pyYExpr: 'np.sin(t)', color: '#fff', label: '' }, tDomain: [0, Math.PI], strokeWidth: 1, label: '', layer: 0, startTime: 0, duration: 1, x: 0, y: 0, scale: 1, posSteps: [] };
    const attached = { ...dot, dot: { ...dot.dot, attachment: { kind: 'parametric' as const, graphCurveId: 'c', t: 0 } } };
    const paramClip: TargetAnimationItem = { kind: 'target_animation', id: 'param', label: '', layer: 0, mode: 'graphFollow', startTime: 0, duration: 2, targets: [{ targetId: 'd', targetT: Math.PI, easing: 'linear' }] };
    const result = resolveGraphDotPosition({ dot: attached, items: [attached, axes, curve, paramClip], time: 1 });
    expect(result.error).toBeNull();
    expect(result.point.x).toBeCloseTo(0);
    expect(result.point.y).toBeCloseTo(1);
    const changedCurve = { ...curve, curve: { ...curve.curve, jsXExpr: '2*Math.cos(t)' } };
    const changedPoint = resolveGraphDotPosition({ dot: attached, items: [attached, axes, changedCurve], time: 0 });
    expect(changedPoint.point.x).toBeCloseTo(2);
    const freeRow = { ...paramClip, targets: [{ targetId: 'd', graphCurveId: 'c', targetT: Math.PI }] };
    expect(resolveGraphDotPosition({ dot, items: [dot, axes, curve, freeRow], time: 1 }).error).toMatch(/cannot use parametric/);
  });
  it('blocks undefined parametric intervals and missing attached curves', () => {
    const discontinuous: GraphCurveItem = { kind: 'graphCurve', id: 'hole-curve', axesId: 'a', curve: { id: 'hole-data', jsXExpr: 't', jsYExpr: '1/t', pyXExpr: 't', pyYExpr: '1/t', color: '#fff', label: '' }, tDomain: [-1, 1], strokeWidth: 1, label: '', layer: 0, startTime: 0, duration: 1, x: 0, y: 0, scale: 1, posSteps: [] };
    const attached = { ...dot, dot: { ...dot.dot, attachment: { kind: 'parametric' as const, graphCurveId: discontinuous.id, t: -1 } } };
    const clip: TargetAnimationItem = { kind: 'target_animation', id: 'hole-motion', label: '', layer: 0, mode: 'graphFollow', startTime: 0, duration: 1, targets: [{ targetId: 'd', targetT: 1 }] };
    expect(resolveGraphDotPosition({ dot: attached, items: [attached, axes, discontinuous, clip], time: 0.5 }).error).toMatch(/undefined|discontinuity/);
    expect(resolveGraphDotPosition({ dot: attached, items: [attached, axes, clip], time: 0.5 }).error).toMatch(/curve is missing/);
  });
  it('shares graph-dot eligibility and reports the effective minimum clip start', () => {
    const lateDot = { ...dot, startTime: 5 };
    const lateClip = { ...clip, startTime: 4, targets: [{ targetId: 'd', graphPlotId: 'p', targetX: 1 }] };
    const items = new Map<string, SceneItem>([[lateDot.id, lateDot], [plot.id, plot]]);
    expect(isGraphFollowTarget(lateDot)).toBe(true);
    expect(isGraphFollowTarget(plot)).toBe(false);
    expect(graphFollowMinimumStartTime(lateClip, items)).toBe(5);
    expect(graphFollowStartTimeError(lateClip, items)).toMatch(/dot appears/);
    expect(graphFollowStartTimeError({ ...lateClip, startTime: 5 }, items)).toBeNull();
    expect(resolveGraphDotPosition({ dot: lateDot, items: [lateDot, axes, plot, lateClip], time: 5 }).error).toMatch(/dot appears/);
  });
  it('resolves graph-space interpolation and destination hold', () => {
    expect(resolveGraphDotPosition({ dot, items: [dot, axes, plot, clip], time: 2 }).point).toEqual({ x: 1, y: 1 });
    expect(resolveGraphDotPosition({ dot, items: [dot, axes, plot, clip], time: 9 }).point).toEqual({ x: 2, y: 4 });
  });
  it('rejects an off-curve start and overlapping position writers', () => {
    const badDot = { ...dot, dot: { ...dot.dot, dy: 1 } };
    expect(resolveGraphDotPosition({ dot: badDot, items: [badDot, axes, plot, clip], time: 1 }).error).toMatch(/not on plot/);
    const conflict = { ...clip, id: 'other', startTime: 2 };
    expect(graphMotionConflicts('d', [clip, conflict])[0]).toMatch(/overlap/);
  });
  it('reports missing plots and nonfinite destinations', () => {
    expect(resolveGraphDotPosition({ dot, items: [dot, axes, { ...clip, targets: [{ targetId: 'd', graphPlotId: 'missing', targetX: 2 }] }], time: 1 }).error).toMatch(/needs a .*plot/);
    expect(resolveGraphDotPosition({ dot, items: [dot, axes, plot, { ...clip, targets: [{ targetId: 'd', graphPlotId: 'p', targetX: Number.NaN }] }], time: 1 }).error).toMatch(/invalid target x/);
  });
  it('rejects sampled discontinuities and projects to visible range boundaries', () => {
    const hole = { ...plot, fn: { ...plot.fn, jsExpr: '1 / x' } };
    const fromOne = { ...dot, dot: { ...dot.dot, dx: 1, dy: 1 } };
    expect(resolveGraphDotPosition({ dot: fromOne, items: [fromOne, axes, hole, { ...clip, startTime: 1, targets: [{ targetId: 'd', graphPlotId: 'p', targetX: -1 }] }], time: 1 }).error).toMatch(/undefined|discontinuity/);
    const tangent = { ...plot, fn: { ...plot.fn, jsExpr: 'Math.tan(x)' } };
    const tangentDot = { ...dot, dot: { ...dot.dot, dx: 1, dy: Math.tan(1) } };
    const wideAxes = { ...axes, xRange: [-3, 3, 1] as [number, number, number] };
    expect(resolveGraphDotPosition({ dot: tangentDot, items: [tangentDot, wideAxes, tangent, { ...clip, startTime: 1, targets: [{ targetId: 'd', graphPlotId: 'p', targetX: 2.2 }] }], time: 1 }).error).toMatch(/discontinuity/);
    expect(graphProjectionGuides({ x: 0, y: 1 }, { ...axes, xRange: [2, 8, 1], yRange: [3, 9, 1] })).toEqual({ vertical: { x1: 0, y1: 1, x2: 0, y2: 3 }, horizontal: { x1: 0, y1: 1, x2: 2, y2: 1 } });
  });
});
