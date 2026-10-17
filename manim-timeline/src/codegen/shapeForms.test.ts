import { describe, expect, it } from 'vitest';
import { generateShapeDef, generateShapePos } from '@/codegen/shapeCodegen';
import { exportManimCode } from '@/codegen/manimExporter';
import { createShape, defaultSceneDefaults } from '@/store/factories';
import type { ShapeItem } from '@/types/scene';

const shape = (over: Partial<ShapeItem>): ShapeItem => ({ ...createShape(0), id: 's1', ...over });
const pos = (item: ShapeItem) => generateShapePos(item, 's1', 0, new Map(), new Map([[item.id, item]]));

describe('basic forms export', () => {
  it('emits an Ellipse from width and height', () => {
    const code = generateShapeDef(shape({ shapeType: 'ellipse', width: 2.6, height: 1.4 }), 's1', 0);
    expect(code).toContain('s1 = Ellipse(width=2.6000, height=1.4000,');
  });

  it('rounds rectangle corners only when the radius is positive, clamped to half the short side', () => {
    expect(generateShapeDef(shape({ shapeType: 'rectangle', width: 2, height: 1 }), 's1', 0)).toContain('s1 = Rectangle(');
    expect(generateShapeDef(shape({ shapeType: 'rectangle', width: 2, height: 1, cornerRadius: 0.3 }), 's1', 0)).toContain(
      'RoundedRectangle(corner_radius=0.3000, width=2.0000, height=1.0000',
    );
    expect(generateShapeDef(shape({ shapeType: 'rectangle', width: 2, height: 1, cornerRadius: 5 }), 's1', 0)).toContain('corner_radius=0.5000');
  });

  it('emits a RegularPolygon with a flat bottom edge and clamps the side count', () => {
    expect(generateShapeDef(shape({ shapeType: 'regularPolygon', sides: 3, radius: 1 }), 's1', 0)).toContain(
      'RegularPolygon(n=3, radius=1.0000, start_angle=-0.523599',
    );
    expect(generateShapeDef(shape({ shapeType: 'regularPolygon', sides: 40, radius: 1 }), 's1', 0)).toContain('RegularPolygon(n=12,');
  });

  it('emits a Polygon from local points and places it by its anchor', () => {
    const item = shape({ shapeType: 'polygon', x: 1, y: -2, rotationDeg: 30, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] });
    const def = generateShapeDef(item, 's1', 0);
    expect(def).toContain('Polygon([0.0000, 0.0000, 0], [1.0000, 0.0000, 0], [0.0000, 1.0000, 0]');
    const p = pos(item);
    expect(p).toContain('s1.shift(1.000000*RIGHT + -2.000000*UP)');
    // Konva rotation is clockwise; Manim rotates counter-clockwise about the anchor.
    expect(p).toContain('s1.rotate(-30.0000 * DEGREES, about_point=[1.000000, -2.000000, 0])');
  });

  it('places a regular polygon by its centre anchor', () => {
    const p = pos(shape({ shapeType: 'regularPolygon', sides: 6, x: 2, y: 1 }));
    expect(p).toContain('s1.shift(2.000000*RIGHT + 1.000000*UP)');
  });
});

describe('line styles export', () => {
  const opts = { fullFile: true, defaults: defaultSceneDefaults() };

  it('wraps a dashed outline in _dashed and ships the helper only when used', () => {
    const dashed = shape({ shapeType: 'rectangle', lineStyle: 'dashed' });
    expect(generateShapeDef(dashed, 's1', 0)).toMatch(/s1 = _dashed\(Rectangle\(.*\), 0\.2, 0\.55\)/);
    expect(exportManimCode([dashed], opts)).toContain('def _dashed(m, period, ratio):');
    expect(exportManimCode([shape({ shapeType: 'rectangle' })], opts)).not.toContain('def _dashed(');
  });

  it('dots a polyline path with the dotted pattern', () => {
    const code = generateShapeDef(shape({ shapeType: 'polyline', lineStyle: 'dotted', headArrow: true }), 's1', 0);
    expect(code).toContain('_s1_path = _dashed(_s1_path, 0.1, 0.2)');
    expect(code).toContain('_s1_head = Arrow(');
  });

  it('dashes an arrow shaft after placement and keeps the tip solid', () => {
    const item = shape({ shapeType: 'arrow', lineStyle: 'dashed', endX: 2, endY: 1 });
    expect(pos(item)).toContain('s1 = _dashed_arrow(s1, 0.2, 0.55)');
    const full = exportManimCode([item], opts);
    expect(full).toContain('def _dashed_arrow(a, period, ratio):');
    expect(full).toContain('tips = a.pop_tips()');
  });
});

describe('arcs, sectors and rings export', () => {
  it('emits an Arc in radians, centred on the anchor', () => {
    const item = shape({ shapeType: 'arc', radius: 1.5, startAngleDeg: 30, angleDeg: -120, x: 1, y: 2 });
    expect(generateShapeDef(item, 's1', 0)).toContain('s1 = Arc(radius=1.5000, angle=-2.094395, start_angle=0.523599,');
    expect(generateShapeDef(item, 's1', 0)).toContain('fill_opacity=0');
    expect(pos(item)).toContain('s1.shift(1.000000*RIGHT + 2.000000*UP)');
  });

  it('emits sectors as AnnularSector (inner radius 0 = a pie slice) and rings as Annulus', () => {
    expect(generateShapeDef(shape({ shapeType: 'sector', radius: 1, fillColor: '#ff0000' }), 's1', 0)).toContain(
      'AnnularSector(inner_radius=0.0000, outer_radius=1.0000, angle=1.570796, start_angle=0.000000,',
    );
    expect(generateShapeDef(shape({ shapeType: 'sector', radius: 1, innerRadius: 0.4 }), 's1', 0)).toContain('inner_radius=0.4000');
    expect(generateShapeDef(shape({ shapeType: 'annulus', radius: 1 }), 's1', 0)).toContain('Annulus(inner_radius=0.5000, outer_radius=1.0000,');
  });

  it('dashes each closed part of a ring on its own', () => {
    const full = exportManimCode([shape({ shapeType: 'annulus', radius: 1, lineStyle: 'dashed' })], { fullFile: true, defaults: defaultSceneDefaults() });
    expect(full).toContain('for path in sub.get_subpaths():');
    expect(full).toMatch(/_dashed\(Annulus\(/);
  });
});

describe('double arrows, curved arrows and braces export', () => {
  it('builds them between the ends around the origin and shifts them to the anchor', () => {
    const d = shape({ shapeType: 'doubleArrow', endX: 2, endY: 1, x: 3, y: -1 });
    expect(generateShapeDef(d, 's1', 0)).toContain('s1 = DoubleArrow([-1.000000, -0.500000, 0], [1.000000, 0.500000, 0],');
    expect(pos(d)).toContain('s1.shift(3.000000*RIGHT + -1.000000*UP)');
    const c = generateShapeDef(shape({ shapeType: 'curvedArrow', endX: 2, endY: 0, arcAngleDeg: -90 }), 's1', 0);
    expect(c).toContain('CurvedArrow([-1.000000, 0.000000, 0], [1.000000, 0.000000, 0], angle=-1.570796,');
    expect(c).toContain('tip_length=min(0.35, 0.25 * float(np.linalg.norm(');
    expect(generateShapeDef(shape({ shapeType: 'brace', endX: 2, endY: 0 }), 's1', 0)).toMatch(/^s1 = BraceBetweenPoints\(.*, buff=0\.1, color=/);
  });

  it('puts a brace label at the tip as a HebrewMathLine in one group', () => {
    const code = generateShapeDef(shape({ shapeType: 'brace', endX: 2, endY: 0, braceLabel: ' $\\Delta x$ ' }), 's1', 0);
    expect(code).toContain('_s1_brace = BraceBetweenPoints(');
    expect(code).toContain('_s1_label = HebrewMathLine("$\\\\Delta x$", font_size=32.000000,');
    expect(code).toContain('_s1_label.next_to(_s1_brace.get_tip(), np.round(_s1_brace.get_direction()), buff=0.15)');
    expect(code).toContain('s1 = VGroup(_s1_brace, _s1_label)');
  });

  it('redraws a labelled connector brace and moves its label every frame', () => {
    const item = shape({
      shapeType: 'brace',
      braceLabel: 'L',
      endpoints: { start: { kind: 'point', x: 0, y: 0 }, end: { kind: 'point', x: 3, y: 0 } },
    });
    const code = exportManimCode([item], { fullFile: true, defaults: defaultSceneDefaults() });
    expect(code).toContain('VGroup(BraceBetweenPoints(ORIGIN, RIGHT * 0.001, buff=0.1,');
    expect(code).toContain('m[0].become(BraceBetweenPoints(_a, _b, buff=0.1, color=m[0].get_color()))');
    expect(code).toContain('m[1].next_to(m[0].get_tip(), np.round(m[0].get_direction()), buff=0.15)');
  });

  it('dashes a curved arrow like a straight one', () => {
    expect(pos(shape({ shapeType: 'curvedArrow', lineStyle: 'dotted' }))).toContain('s1 = _dashed_arrow(s1, 0.1, 0.2)');
  });
});
