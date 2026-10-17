import { describe, expect, it } from 'vitest';
import { createShape, createSurroundingRect } from '@/store/factories';
import type { ItemId, SceneItem, ShapeItem, ShapePoint } from '@/types/scene';
import { bracePath } from './shapeGeometry';
import { partialCreatePart, shapeCreateFrame, shapeCreatePlan, surroundCreatePlan, svgPathCurves } from './shapeCreatePreview';
import { manimSmoothProgress, shapeIntroPreview, surroundIntroPreview } from './visualPlaybackPreview';

const shape = (patch: Partial<ShapeItem>): ShapeItem => ({ ...createShape(0), ...patch });
const last = (sp: ShapePoint[][]) => sp[sp.length - 1]![sp[sp.length - 1]!.length - 1]!;
const near = (p: ShapePoint, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 6);
  expect(p.y).toBeCloseTo(y, 6);
};

describe('shape Create preview', () => {
  it('parses the brace into the 25 curves Manim draws, from its first end', () => {
    expect(svgPathCurves('m0 0h1v1z')).toEqual([
      [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      [{ x: 1, y: 0 }, { x: 1, y: 1 }],
      [{ x: 1, y: 1 }, { x: 0, y: 0 }],
    ]);
    expect(svgPathCurves(bracePath(2).data)).toHaveLength(25);
    const brace = shapeCreatePlan(shape({ shapeType: 'brace', endX: 2, endY: 0 }));
    expect(brace.parts).toHaveLength(1);
    expect(brace.parts[0]!.fill).toBe('stroke');
    // Manim's BraceBetweenPoints([-1,0,0],[1,0,0], buff=0.1) starts at about (-0.994, -0.1).
    const start = brace.parts[0]!.curves[0]![0]!;
    expect(start.x).toBeCloseTo(-0.994, 2);
    expect(start.y).toBeCloseTo(-0.1, 2);
  });

  it('draws a circle counter-clockwise from angle 0 and a rectangle edge by edge from its top-right', () => {
    const circle = shapeCreatePlan(shape({ shapeType: 'circle', radius: 1 })).parts[0]!;
    expect(circle.curves).toHaveLength(8);
    near(circle.curves[0]![0]!, 1, 0);
    near(last(partialCreatePart(circle, 0.5)), -1, 0);

    // Manim gives each edge the same time, however long it is.
    const rect = shapeCreatePlan(shape({ shapeType: 'rectangle', width: 4, height: 1 })).parts[0]!;
    expect(rect.curves).toHaveLength(4);
    near(rect.curves[0]![0]!, 2, 0.5);
    near(last(partialCreatePart(rect, 0.25)), -2, 0.5);
    near(last(partialCreatePart(rect, 0.375)), -2, 0);

    const rounded = shapeCreatePlan(shape({ shapeType: 'rectangle', width: 2, height: 1, cornerRadius: 0.2 })).parts[0]!;
    expect(rounded.curves).toHaveLength(8);
    near(rounded.curves[0]![0]!, 1, 0.3);
  });

  it('draws a ring outer circle first, then the inner one, and a sector from its inner arc', () => {
    const ring = shapeCreatePlan(shape({ shapeType: 'annulus', radius: 1, innerRadius: 0.5 })).parts[0]!;
    expect(ring.curves).toHaveLength(16);
    expect(partialCreatePart(ring, 0.5)).toHaveLength(1);
    expect(partialCreatePart(ring, 1)).toHaveLength(2);
    // The inner circle runs clockwise, so the filled ring keeps its hole.
    const inner = ring.curves[8]!;
    near(inner[0]!, 0.5, 0);
    expect(inner[1]!.y).toBeLessThan(0);

    const sector = shapeCreatePlan(shape({ shapeType: 'sector', radius: 1, innerRadius: 0.5, startAngleDeg: 0, angleDeg: 90 })).parts[0]!;
    expect(sector.curves).toHaveLength(18);
    near(sector.curves[0]![0]!, 0.5, 0);
    near(sector.curves[8]![0]!, 0, 0.5);
  });

  it('creates an arrow shaft first, then its tip, each eased on its own', () => {
    const plan = shapeCreatePlan(shape({ shapeType: 'arrow', endX: 2, endY: 0 }));
    expect(plan.parts.map((p) => p.fill)).toEqual(['none', 'stroke']);
    const quarter = shapeCreateFrame(plan, 0.25);
    expect(quarter.parts).toHaveLength(1);
    // Shaft at smooth(0.5) = 0.5: from x = -1 to halfway to the tip's base.
    const shaftEnd = 1 - Math.min(0.35 * 0.9, 2);
    near(last(quarter.parts[0]!.subpaths), (-1 + shaftEnd) / 2, 0);
    const late = shapeCreateFrame(plan, 0.75);
    expect(late.parts).toHaveLength(2);
    near(last(late.parts[0]!.subpaths), shaftEnd, 0);
    near(late.parts[1]!.subpaths[0]![0]!, 1, 0);

    const double = shapeCreatePlan(shape({ shapeType: 'doubleArrow', endX: 2, endY: 0 }));
    expect(double.parts).toHaveLength(3);
    near(double.parts[1]!.curves[0]![0]!, 1, 0);
    near(double.parts[2]!.curves[0]![0]!, -1, 0);

    const curved = shapeCreatePlan(shape({ shapeType: 'curvedArrow', endX: 2, endY: 0, arcAngleDeg: 60 }));
    expect(curved.parts[0]!.curves).toHaveLength(8);
    near(curved.parts[0]!.curves[0]![0]!, -1, 0);
    near(curved.parts[1]!.curves[0]![0]!, 1, 0);
  });

  it('draws a dashed outline as a run of dashes after its fill, and a brace label last', () => {
    const plan = shapeCreatePlan(shape({ shapeType: 'circle', radius: 1, lineStyle: 'dashed', fillColor: '#ff0000', fillOpacity: 0.5 }));
    expect(plan.parts.map((p) => [p.fill, p.stroke, p.slots])).toEqual([
      ['shape', false, 1],
      ['none', true, Math.round((2 * Math.PI) / 0.2)],
    ]);
    expect(plan.parts[1]!.byLength).toBe(true);

    const labelled = shapeCreatePlan(shape({ shapeType: 'brace', endX: 2, endY: 0, braceLabel: 'a b' }));
    expect(labelled.labelSlots).toBe(2);
    expect(shapeCreateFrame(labelled, 1 / 3).labelProgress).toBe(0);
    expect(shapeCreateFrame(labelled, 0.5).labelProgress).toBeCloseTo(manimSmoothProgress(0.5) / 2, 9);
    expect(shapeCreateFrame(labelled, 1).labelProgress).toBe(1);
  });

  it('times the entrance over the clip: fade in eases the opacity, create reports linear progress', () => {
    const fade = shape({ id: 'f' as ItemId, startTime: 1, duration: 2, introStyle: 'fade_in' });
    const create = shape({ id: 'c' as ItemId, startTime: 1, duration: 2, introStyle: 'create' });
    const items = new Map<ItemId, SceneItem>([
      [fade.id, fade],
      [create.id, create],
    ]);
    expect(shapeIntroPreview(fade, 0.5, items)).toEqual({ opacity: 0, createProgress: 1 });
    expect(shapeIntroPreview(fade, 1.5, items).opacity).toBeCloseTo(manimSmoothProgress(0.25), 9);
    expect(shapeIntroPreview(fade, 3.5, items)).toEqual({ opacity: 1, createProgress: 1 });
    expect(shapeIntroPreview(create, 1.5, items)).toEqual({ opacity: 1, createProgress: 0.25 });
    expect(shapeIntroPreview(create, 3, items).createProgress).toBe(1);
    const atStart = { ...create, visibleAtSceneStart: true };
    expect(shapeIntroPreview(atStart, 1.5, new Map([[atStart.id, atStart]])).createProgress).toBe(1);
  });

  it('creates a surrounding rectangle from its top-right corner and strike lines one after another', () => {
    const box = surroundCreatePlan({ left: 1, right: 5, bottom: -1, top: 1 }, 0).parts[0]!;
    expect(box.curves).toHaveLength(4);
    near(box.curves[0]![0]!, 5, 1);
    near(last(partialCreatePart(box, 0.25)), 1, 1);
    expect(surroundCreatePlan({ left: 1, right: 5, bottom: -1, top: 1 }, 0.3).parts[0]!.curves).toHaveLength(8);

    const strike = surroundCreatePlan({ left: 0, right: 1, bottom: 0, top: 1 }, 0, [
      { x1: 0, y1: 0, x2: 2, y2: 0 },
      { x1: 1, y1: 1, x2: 1, y2: -1 },
    ]);
    expect(strike.parts).toHaveLength(2);
    const half = shapeCreateFrame(strike, 0.5);
    expect(half.parts).toHaveLength(1);
    near(last(half.parts[0]!.subpaths), 2, 0);
  });

  it('times a surrounding rectangle over its run time', () => {
    const sr = { ...createSurroundingRect(['t' as ItemId], 1), runTime: 2 };
    const items = new Map<ItemId, SceneItem>([[sr.id, sr]]);
    expect(surroundIntroPreview({ ...sr, introStyle: 'create' }, 1.5, items)).toEqual({ opacity: 1, createProgress: 0.25 });
    expect(surroundIntroPreview({ ...sr, introStyle: 'fade_in' }, 1.5, items).opacity).toBeCloseTo(manimSmoothProgress(0.25), 9);
    expect(surroundIntroPreview(sr, 3.5, items)).toEqual({ opacity: 1, createProgress: 1 });
  });
});
