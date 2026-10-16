import { describe, expect, it } from 'vitest';
import { createAxes, createGraphDotItem, createGraphPlot, createTargetAnimation, defaultSceneDefaults } from '@/store/factories';
import type { GraphCurveItem, GraphDotItem, ItemId, SceneItem } from '@/types/scene';
import { effectiveTrace, graphDotTrail } from './graphDotTrail';

/** Plot y = x² on [-2, 2]; dot at x = -2 from 1 s, moving linearly to x = 2 over 2..4 s. */
function scene(trace: GraphDotItem['dot']['trace']) {
  const axes = createAxes(defaultSceneDefaults());
  axes.id = 'ax';
  axes.xRange = [-2, 2, 1];
  axes.yRange = [0, 4, 1];
  const plot = createGraphPlot(axes.id);
  plot.id = 'p';
  plot.fn = { ...plot.fn, jsExpr: 'x*x', pyExpr: 'x**2' };
  plot.xDomain = [-2, 2];
  const dot = createGraphDotItem(axes.id, 1);
  dot.id = 'd';
  dot.duration = 0.5;
  dot.dot = { ...dot.dot, attachment: { kind: 'function', graphPlotId: 'p', x: -2 }, trace };
  const follow = createTargetAnimation('graphFollow', ['d'], 2, 2);
  follow.id = 'f';
  follow.targets[0] = { targetId: 'd', targetX: 2, easing: 'linear' };
  return { dot, items: new Map<ItemId, SceneItem>([axes, plot, dot, follow].map((it) => [it.id, it])) };
}

describe('graph dot trail', () => {
  it('fills defaults from the dot', () => {
    const { dot } = scene({ fadeSeconds: 0 });
    expect(effectiveTrace(dot.dot)).toEqual({ color: dot.dot.color, width: 3, fadeSeconds: null });
    expect(effectiveTrace({ ...dot.dot, trace: undefined })).toBeNull();
  });

  it('runs from where the dot appeared to where it is, on the curve', () => {
    const { dot, items } = scene({});
    expect(graphDotTrail(dot, items, 0.5)).toEqual([]);
    const trail = graphDotTrail(dot, items, 3); // x = 0 at 3 s
    expect(trail[0]).toMatchObject({ x: -2, y: 4, age: 2 });
    expect(trail.at(-1)).toMatchObject({ x: 0, y: 0, age: 0 });
    for (const q of trail) expect(q.y).toBeCloseTo(q.x * q.x, 9);
    expect(trail.length).toBe(121); // 2 s × 60 samples + 1
  });

  it('keeps only the last fadeSeconds', () => {
    const { dot, items } = scene({ fadeSeconds: 0.5 });
    const trail = graphDotTrail(dot, items, 3);
    expect(trail[0]!.age).toBeCloseTo(0.5, 9);
    expect(trail[0]!.x).toBeCloseTo(-1, 9); // 2 units/s → 1 unit behind
  });

  it('follows a parametric curve by t', () => {
    const { dot, items } = scene({});
    const curve = { id: 'c', kind: 'graphCurve', axesId: 'ax', curve: { jsXExpr: 'Math.cos(t)', jsYExpr: 'Math.sin(t)', pyXExpr: 'np.cos(t)', pyYExpr: 'np.sin(t)' }, tDomain: [0, 6.3] } as unknown as GraphCurveItem;
    items.set('c', curve);
    const d = { ...dot, dot: { ...dot.dot, attachment: { kind: 'parametric' as const, graphCurveId: 'c', t: 0 } } };
    items.set('d', d);
    const f = items.get('f') as Extract<SceneItem, { kind: 'target_animation' }>;
    items.set('f', { ...f, targets: [{ targetId: 'd', targetT: Math.PI, easing: 'linear' }] });
    const trail = graphDotTrail(d, items, 4);
    expect(trail[0]).toMatchObject({ x: 1, y: 0 });
    expect(trail.at(-1)!.x).toBeCloseTo(-1, 9);
    for (const q of trail) expect(Math.hypot(q.x, q.y)).toBeCloseTo(1, 9);
  });
});
