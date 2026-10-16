import { describe, expect, it } from 'vitest';
import { generateShapeDef, generateShapePos } from '@/codegen/shapeCodegen';
import { exportManimCode } from '@/codegen/manimExporter';
import { createAxes, createGraphDotItem, createGraphPlot, createTargetAnimation, defaultSceneDefaults } from '@/store/factories';
import type { SceneItem, ShapeItem } from '@/types/scene';
import { DEFAULT_SHAPE_POLYLINE_POINTS } from '@/types/scene';

function baseShape(over: Partial<ShapeItem> = {}): ShapeItem {
  return {
    id: 's1',
    kind: 'shape',
    label: '',
    layer: 0,
    startTime: 0,
    duration: 1,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    audioTrackId: null,
    shapeType: 'polyline',
    rotationDeg: 0,
    radius: 0.5,
    width: 2,
    height: 1,
    endX: 2,
    endY: 0,
    points: DEFAULT_SHAPE_POLYLINE_POINTS.map((p) => ({ ...p })),
    tailArrow: false,
    headArrow: false,
    strokeColor: '#60a5fa',
    strokeWidth: 3,
    fillColor: null,
    fillOpacity: 0.25,
    introStyle: 'create',
    ...over,
  };
}

describe('generateShapeDef polyline', () => {
  it('emits VMobject path and set_points_as_corners; no Arrow or add_tip when no arrow flags', () => {
    const code = generateShapeDef(
      baseShape({ headArrow: false, tailArrow: false }),
      'pl1',
      0,
    );
    expect(code).toContain('_pl1_path = VMobject(');
    expect(code).toContain('set_points_as_corners');
    expect(code).toContain('[-1.0000, 0.0000, 0]');
    expect(code).toContain('pl1 = _pl1_path');
    expect(code).not.toMatch(/=\s*Arrow\(/);
    expect(code).not.toContain('add_tip');
    expect(code).not.toContain('VGroup');
  });

  it('head arrow adds explicit Arrow + VGroup', () => {
    const code = generateShapeDef(baseShape({ headArrow: true }), 'pl1', 0);
    expect(code).toContain('_pl1_head = Arrow(');
    expect(code).toContain('_pl1_head.set_stroke(opacity=0)');
    expect(code).toContain('pl1 = VGroup(_pl1_path, _pl1_head)');
    expect(code).not.toContain('add_tip');
  });

  it('tail arrow adds explicit Arrow + VGroup', () => {
    const code = generateShapeDef(
      baseShape({ tailArrow: true, headArrow: false }),
      'pl1',
      0,
    );
    expect(code).toContain('_pl1_tail = Arrow(');
    expect(code).toContain('_pl1_tail.set_stroke(opacity=0)');
    expect(code).toContain('pl1 = VGroup(_pl1_path, _pl1_tail)');
    expect(code).not.toContain('add_tip');
  });

  it('head and tail both add two Arrow lines', () => {
    const code = generateShapeDef(
      baseShape({ headArrow: true, tailArrow: true }),
      'pl1',
      0,
    );
    expect(code).toContain('_pl1_head = Arrow(');
    expect(code).toContain('_pl1_tail = Arrow(');
    expect(code).toMatch(/pl1 = VGroup\(_pl1_path, _pl1_head, _pl1_tail\)/);
  });

  it('does not throw for empty points and still emits corners', () => {
    const code = generateShapeDef(baseShape({ points: [] }), 'pl1', 0);
    expect(code).toContain('set_points_as_corners');
    expect(code).toContain('pl1');
  });
});

describe('generateShapePos placement', () => {
  const mapSelf = (item: ShapeItem) => new Map([[item.id, item]]);

  it('absolute polyline uses shift (local origin at anchor), not move_to', () => {
    const item = baseShape({
      x: 1,
      y: 2,
      points: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 1 },
      ],
      posSteps: [{ kind: 'absolute' }],
    });
    const code = generateShapePos(item, 'pl1', 0, new Map(), mapSelf(item));
    expect(code).toContain('pl1.shift(1.000000*RIGHT + 2.000000*UP)');
    expect(code).not.toContain('pl1.move_to([1.000000, 2.000000, 0])');
  });

  it('absolute line still uses move_to (center-anchored like canvas)', () => {
    const item = baseShape({
      shapeType: 'line',
      endX: 1,
      endY: 0,
      x: 1,
      y: 2,
      posSteps: [{ kind: 'absolute' }],
    });
    const code = generateShapePos(item, 'ln1', 0, new Map(), mapSelf(item));
    expect(code).toContain('ln1.move_to([1.000000, 2.000000, 0])');
    expect(code).not.toMatch(/ln1\.shift\(1\.000000\*RIGHT \+ 2\.000000\*UP\)/);
  });

  it('polyline rotation and scale use resolved anchor as about_point', () => {
    const item = baseShape({
      x: 0.5,
      y: -0.25,
      rotationDeg: 30,
      scale: 1.5,
      posSteps: [{ kind: 'absolute' }],
    });
    const code = generateShapePos(item, 'pl1', 0, new Map(), mapSelf(item));
    expect(code).toContain('about_point=[0.500000, -0.250000, 0]');
    expect(code).toMatch(/\.rotate\(.*about_point=\[0\.500000, -0\.250000, 0\]/);
    expect(code).toMatch(/\.scale\(1\.500000, about_point=\[0\.500000, -0\.250000, 0\]/);
  });
});

describe('connector export', () => {
  const scene = () => {
    const axes = createAxes(defaultSceneDefaults());
    axes.id = 'ax';
    axes.xRange = [0, 1, 0.5];
    axes.yRange = [0, 2, 1];
    const plot = createGraphPlot(axes.id, 0);
    plot.id = 'p';
    plot.fn = { ...plot.fn, jsExpr: 'x*x + 1', pyExpr: 'x**2 + 1' };
    plot.xDomain = [0, 1];
    const dot = createGraphDotItem(axes.id, 2);
    dot.id = 'd';
    dot.dot.attachment = { kind: 'function', graphPlotId: 'p', x: 0 };
    const follow = createTargetAnimation('graphFollow', [dot.id], 3, 2);
    follow.id = 'f';
    follow.targets[0] = { targetId: dot.id, targetX: 1, easing: 'smooth' };
    const seg = baseShape({
      id: 'seg',
      shapeType: 'line',
      startTime: 2.5,
      duration: 0.5,
      endpoints: { start: { kind: 'graphDot', dotId: 'd' }, end: { kind: 'graphDotFoot', dotId: 'd', axis: 'x' } },
    });
    return [axes, plot, dot, follow, seg];
  };

  it('binds the connector after placement with a redraw updater and a driver', () => {
    const code = exportManimCode(scene(), { fullFile: true, defaults: defaultSceneDefaults() });
    expect(code).not.toContain('EXPORT ERROR');
    const bind = code.indexOf('.add_updater(_');
    expect(bind).toBeGreaterThan(code.indexOf('Line(ORIGIN, RIGHT * 0.001'));
    expect(bind).toBeLessThan(code.indexOf('self.play('));
    expect(code).toMatch(/_a = axes_\d+_dot_d\.get_center\(\)/);
    expect(code).toMatch(/_b = \(lambda _c: axes_\d+\.c2p\(_c\[0\], 0\.0\)\)\(axes_\d+\.p2c\(axes_\d+_dot_d\.get_center\(\)\)\)/);
    expect(code).toContain('m.become(Line(_a, _b, color=m.get_color()');
    expect(code).toMatch(/self\.add\(_\w+_driver\)/);
    expect(code).toContain('import numpy as np');
  });

  it('reports a connector whose anchor is missing as an export error', () => {
    const items = scene().filter((it) => it.id !== 'd' && it.id !== 'f');
    expect(exportManimCode(items, { fullFile: false, defaults: defaultSceneDefaults() })).toMatch(/EXPORT ERROR: Connector/);
  });

  it('emits the foot with the nearest range edge when 0 is outside the range', () => {
    const items = scene();
    (items[0] as { yRange: [number, number, number] }).yRange = [1, 3, 1];
    const code = exportManimCode(items, { fullFile: false, defaults: defaultSceneDefaults() });
    expect(code).toContain('(1.000000 if abs(_c[1] - 1.000000) <= abs(_c[1] - 3.000000) else 3.000000)');
  });

  it('draws a tangent from the plot expression at the dot, clamped to the domain', () => {
    const items = scene();
    const seg = items[4] as ShapeItem;
    seg.endpoints = { start: { kind: 'graphDot', dotId: 'd' }, end: { kind: 'graphDot', dotId: 'd' }, tangent: { length: 2 } };
    const code = exportManimCode(items, { fullFile: false, defaults: defaultSceneDefaults() });
    expect(code).not.toContain('EXPORT ERROR');
    expect(code).toMatch(/_c = axes_\d+_dot_d\.get_center\(\)\n\s+_x = axes_\d+\.p2c\(_c\)\[0\]/);
    expect(code).toContain('_x0, _x1 = max(0.000000, _x - 1.000000e-4), min(1.000000, _x + 1.000000e-4)');
    expect(code).toContain('_f = (lambda x: (x**2 + 1))');
    expect(code).toMatch(/_d = axes_\d+\.c2p\(_x1, _f\(_x1\)\) - axes_\d+\.c2p\(_x0, _f\(_x0\)\)/);
    expect(code).toContain('_d = _d / max(np.linalg.norm(_d), 1e-9) * 1.000000');
    expect(code).toContain('_a, _b = _c - _d, _c + _d');
  });

  it('lengthens a line through two points past both ends', () => {
    const items = scene();
    const seg = items[4] as ShapeItem;
    seg.endpoints = { ...seg.endpoints!, extend: 1.5 };
    const code = exportManimCode(items, { fullFile: false, defaults: defaultSceneDefaults() });
    expect(code).toContain('_e = (_b - _a) / _n * 1.500000');
    expect(code).toContain('_a, _b = _a - _e, _b + _e');
    expect(code.indexOf('_e = (_b - _a)')).toBeLessThan(code.indexOf('m.become(Line(_a, _b'));
  });

  it('reports a tangent on a dot without a function plot', () => {
    const items = scene();
    const dot = items[2] as Extract<SceneItem, { kind: 'graphDot' }>;
    dot.dot.attachment = { kind: 'free' };
    (items[3] as Extract<SceneItem, { kind: 'target_animation' }>).targets[0]!.graphPlotId = undefined;
    const seg = items[4] as ShapeItem;
    seg.endpoints = { start: { kind: 'graphDot', dotId: 'd' }, end: { kind: 'graphDot', dotId: 'd' }, tangent: { length: 2 } };
    expect(exportManimCode(items, { fullFile: false, defaults: defaultSceneDefaults() })).toMatch(/EXPORT ERROR: Connector "[^"]*": Graph dot "d" is not on a function plot. Set the tangent/);
  });
});
