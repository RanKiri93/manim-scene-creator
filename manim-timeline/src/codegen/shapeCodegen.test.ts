import { describe, expect, it } from 'vitest';
import { generateShapeDef, generateShapePos } from '@/codegen/shapeCodegen';
import type { ShapeItem } from '@/types/scene';
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
