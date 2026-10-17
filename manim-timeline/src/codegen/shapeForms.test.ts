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
