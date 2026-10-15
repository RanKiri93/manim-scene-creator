import { describe, expect, it } from 'vitest';
import {
  createAxes,
  createGraphDotItem,
  createGraphPlot,
  createShape,
  createTargetAnimation,
  createTextLine,
  defaultSceneDefaults,
} from '@/store/factories';
import type { FrameDef, ItemId, SceneItem, ShapeItem } from '@/types/scene';
import {
  axesGraphToWorld,
  connectorStaticGeometry,
  remapShapeAnchor,
  resolveConnectorEndpoints,
} from './shapeAnchors';

const frames: FrameDef[] = [{ id: 'home', col: 0, row: 0 }];

/** Axes on [0, 2] × [-1, 3] at (1, 0.5), plot y = x², dot on the plot at x = 0 moving to x = 2 over 2..4 s. */
function scene() {
  const axes = createAxes(defaultSceneDefaults());
  axes.id = 'ax';
  axes.xRange = [0, 2, 0.5];
  axes.yRange = [-1, 3, 1];
  axes.x = 1;
  axes.y = 0.5;
  axes.scaleX = 2;
  axes.scaleY = 1;
  const plot = createGraphPlot(axes.id);
  plot.id = 'p';
  plot.fn = { ...plot.fn, jsExpr: 'x*x', pyExpr: 'x**2' };
  plot.xDomain = [0, 2];
  const dot = createGraphDotItem(axes.id, 1);
  dot.id = 'd';
  dot.dot.attachment = { kind: 'function', graphPlotId: 'p', x: 0 };
  const follow = createTargetAnimation('graphFollow', [dot.id], 2, 2);
  follow.id = 'f';
  follow.targets[0] = { targetId: dot.id, targetX: 2, easing: 'linear' };
  const line = createShape(1);
  line.id = 's';
  line.shapeType = 'line';
  line.endpoints = { start: { kind: 'graphDot', dotId: 'd' }, end: { kind: 'graphDotFoot', dotId: 'd', axis: 'x' } };
  const items = new Map<ItemId, SceneItem>([axes, plot, dot, follow, line].map((it) => [it.id, it]));
  return { axes, items, line };
}

const ctx = (items: Map<ItemId, SceneItem>, time: number) => ({ items, time, frames, startFrameId: 'home' });

describe('connector anchors', () => {
  it('maps graph coordinates around the axes centre with the axis scales', () => {
    const { axes, items } = scene();
    // x mid = 1, y mid = 1 → graph (1, 1) is the axes centre.
    expect(axesGraphToWorld(axes, 1, 1, ctx(items, 0))).toEqual({ x: 1, y: 0.5 });
    expect(axesGraphToWorld(axes, 2, 3, ctx(items, 0))).toEqual({ x: 3, y: 2.5 });
  });

  it('follows the dot along the plot and drops the foot onto y = 0', () => {
    const { axes, items, line } = scene();
    const at = (t: number) => resolveConnectorEndpoints(line, ctx(items, t));
    const before = at(1.5);
    expect(before.error).toBeNull();
    expect(before.start).toEqual(axesGraphToWorld(axes, 0, 0, ctx(items, 1.5)));
    const mid = at(3); // linear easing: x = 1, y = 1
    expect(mid.start).toEqual(axesGraphToWorld(axes, 1, 1, ctx(items, 3)));
    expect(mid.end).toEqual(axesGraphToWorld(axes, 1, 0, ctx(items, 3)));
    const end = at(5);
    expect(end.start).toEqual(axesGraphToWorld(axes, 2, 4, ctx(items, 5)));
    expect(end.end).toEqual(axesGraphToWorld(axes, 2, 0, ctx(items, 5)));
  });

  it('uses the nearest range edge for the foot when 0 is outside the range', () => {
    const { axes, items, line } = scene();
    axes.yRange = [1, 5, 1];
    const r = resolveConnectorEndpoints(line, ctx(items, 5));
    expect(r.end).toEqual(axesGraphToWorld(axes, 2, 5, ctx(items, 5)));
  });

  it('anchors to an object edge and reports missing references', () => {
    const { items, line } = scene();
    const text = createTextLine(defaultSceneDefaults(), 0);
    text.id = 't';
    text.x = -2;
    text.y = 1;
    text.measure = { widthInk: 2, heightInk: 0.5 } as never;
    items.set(text.id, text);
    const objectLine: ShapeItem = { ...line, endpoints: { start: { kind: 'object', itemId: 't', edge: 'RIGHT' }, end: { kind: 'point', x: 0, y: 0 } } };
    const r = resolveConnectorEndpoints(objectLine, ctx(items, 0));
    expect(r.start).toEqual({ x: -1, y: 1 });
    expect(r.end).toEqual({ x: 0, y: 0 });
    const missing: ShapeItem = { ...line, endpoints: { start: { kind: 'graphDot', dotId: 'nope' }, end: { kind: 'point', x: 0, y: 0 } } };
    expect(resolveConnectorEndpoints(missing, ctx(items, 0)).error).toMatch(/not a graph dot/);
  });

  it('bakes the geometry at a time into static line fields', () => {
    const { axes, items, line } = scene();
    const g = connectorStaticGeometry(line, ctx(items, 5))!;
    const top = axesGraphToWorld(axes, 2, 4, ctx(items, 5));
    const foot = axesGraphToWorld(axes, 2, 0, ctx(items, 5));
    expect(g.x).toBeCloseTo((top.x + foot.x) / 2);
    expect(g.endY).toBeCloseTo(foot.y - top.y);
    expect(g.endX).toBeCloseTo(0);
  });

  it('remaps referenced ids', () => {
    const m = new Map([['d', 'd2'], ['ax', 'ax2']]);
    expect(remapShapeAnchor({ kind: 'graphDotFoot', dotId: 'd', axis: 'x' }, m)).toEqual({ kind: 'graphDotFoot', dotId: 'd2', axis: 'x' });
    expect(remapShapeAnchor({ kind: 'graphPoint', axesId: 'ax', x: 1, y: 2 }, m)).toEqual({ kind: 'graphPoint', axesId: 'ax2', x: 1, y: 2 });
  });
});
