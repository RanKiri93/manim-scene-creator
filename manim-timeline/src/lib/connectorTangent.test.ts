import { describe, expect, it } from 'vitest';
import {
  createAxes,
  createGraphDotItem,
  createGraphPlot,
  createShape,
  createTargetAnimation,
  defaultSceneDefaults,
} from '@/store/factories';
import type { FrameDef, ItemId, SceneItem, ShapeItem } from '@/types/scene';
import { axesGraphToWorld, connectorReferencedIds, resolveConnectorEndpoints } from './shapeAnchors';
import { remapSceneItem } from './projectFragment';

const frames: FrameDef[] = [{ id: 'home', col: 0, row: 0 }];
const ctx = (items: Map<ItemId, SceneItem>, time: number) => ({ items, time, frames, startFrameId: 'home' });

/** Axes on [0, 2] × [-1, 3], scaleX 2; plot y = x²; dot q at x = 0 moving to x = 2 over 2..4 s; dot p fixed at x = 1. */
function scene() {
  const axes = createAxes(defaultSceneDefaults());
  axes.id = 'ax';
  axes.xRange = [0, 2, 0.5];
  axes.yRange = [-1, 3, 1];
  axes.scaleX = 2;
  axes.scaleY = 1;
  const plot = createGraphPlot(axes.id);
  plot.id = 'pl';
  plot.fn = { ...plot.fn, jsExpr: 'x*x', pyExpr: 'x**2' };
  plot.xDomain = [0, 2];
  const q = createGraphDotItem(axes.id, 1);
  q.id = 'q';
  q.dot.attachment = { kind: 'function', graphPlotId: 'pl', x: 0 };
  const p = createGraphDotItem(axes.id, 1);
  p.id = 'p';
  p.dot.attachment = { kind: 'function', graphPlotId: 'pl', x: 1 };
  const follow = createTargetAnimation('graphFollow', [q.id], 2, 2);
  follow.id = 'f';
  follow.targets[0] = { targetId: q.id, targetX: 2, easing: 'linear' };
  const tangent: ShapeItem = {
    ...createShape(1),
    id: 't',
    shapeType: 'line',
    endpoints: { start: { kind: 'graphDot', dotId: 'q' }, end: { kind: 'graphDot', dotId: 'q' }, tangent: { length: 2 } },
  };
  const items = new Map<ItemId, SceneItem>([axes, plot, q, p, follow, tangent].map((it) => [it.id, it]));
  return { axes, items, tangent };
}

describe('tangent connector', () => {
  it('is centred on the moving dot, along the slope on screen, and reports dy/dx', () => {
    const { axes, items, tangent } = scene();
    const mid = resolveConnectorEndpoints(tangent, ctx(items, 3)); // linear: x = 1, slope 2
    expect(mid.error).toBeNull();
    if (mid.error != null) return;
    expect(mid.slope).toBeCloseTo(2, 6);
    const c = axesGraphToWorld(axes, 1, 1, ctx(items, 3));
    expect((mid.start.x + mid.end.x) / 2).toBeCloseTo(c.x, 9);
    expect((mid.start.y + mid.end.y) / 2).toBeCloseTo(c.y, 9);
    expect(Math.hypot(mid.end.x - mid.start.x, mid.end.y - mid.start.y)).toBeCloseTo(2, 9);
    // On screen dx = 2 units per graph unit, dy = 1 → direction (2, 2) / |·|.
    expect((mid.end.y - mid.start.y) / (mid.end.x - mid.start.x)).toBeCloseTo(1, 5);
    // At the start of the domain the slope uses a one-sided step and is ~0.
    expect(resolveConnectorEndpoints(tangent, ctx(items, 0)).error).toBeNull();
    const at0 = resolveConnectorEndpoints(tangent, ctx(items, 0));
    expect(at0.error == null && at0.slope).toBeCloseTo(0, 3);
  });

  it('finds the plot from a Move-along-graph clip for a free dot, and names what is missing', () => {
    const { items, tangent } = scene();
    const q = items.get('q') as Extract<SceneItem, { kind: 'graphDot' }>;
    items.set('q', { ...q, dot: { ...q.dot, attachment: { kind: 'free' }, dx: 0, dy: 0 } });
    const f = items.get('f') as Extract<SceneItem, { kind: 'target_animation' }>;
    items.set('f', { ...f, targets: [{ ...f.targets[0]!, graphPlotId: 'pl' }] });
    expect(resolveConnectorEndpoints(tangent, ctx(items, 3)).error).toBeNull();
    items.delete('f');
    expect(resolveConnectorEndpoints(tangent, ctx(items, 3)).error).toMatch(/not on a function plot. Set the tangent's plotId/);
    const onPoint: ShapeItem = { ...tangent, endpoints: { ...tangent.endpoints!, start: { kind: 'point', x: 0, y: 0 } } };
    expect(resolveConnectorEndpoints(onPoint, ctx(items, 3)).error).toMatch(/start anchor on a graph dot/);
  });

  it('extends a segment past both ends (a secant through two dots)', () => {
    const { axes, items } = scene();
    const secant: ShapeItem = {
      ...createShape(1),
      id: 's',
      shapeType: 'line',
      endpoints: { start: { kind: 'graphDot', dotId: 'p' }, end: { kind: 'graphDot', dotId: 'q' }, extend: 1 },
    };
    const r = resolveConnectorEndpoints(secant, ctx(items, 4)); // p (1, 1), q (2, 4)
    expect(r.error).toBeNull();
    if (r.error != null) return;
    const a = axesGraphToWorld(axes, 1, 1, ctx(items, 4));
    const b = axesGraphToWorld(axes, 2, 4, ctx(items, 4));
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    expect(Math.hypot(r.end.x - r.start.x, r.end.y - r.start.y)).toBeCloseTo(len + 2, 9);
    expect(r.start.x).toBeCloseTo(a.x - (b.x - a.x) / len, 9);
    expect(r.end.y).toBeCloseTo(b.y + (b.y - a.y) / len, 9);
  });

  it('counts the tangent plot as a reference and remaps it in fragments', () => {
    const endpoints = { start: { kind: 'graphDot', dotId: 'q' }, end: { kind: 'graphDot', dotId: 'q' }, extend: 0.5, tangent: { length: 2, plotId: 'pl' } } as const;
    expect(connectorReferencedIds(endpoints)).toEqual(['q', 'pl']);
    const shape: ShapeItem = { ...createShape(1), id: 't', shapeType: 'line', endpoints };
    remapSceneItem(shape, new Map([['q', 'q2'], ['pl', 'pl2'], ['t', 't2']]));
    expect(shape.endpoints).toEqual({ start: { kind: 'graphDot', dotId: 'q2' }, end: { kind: 'graphDot', dotId: 'q2' }, extend: 0.5, tangent: { length: 2, plotId: 'pl2' } });
  });
});
