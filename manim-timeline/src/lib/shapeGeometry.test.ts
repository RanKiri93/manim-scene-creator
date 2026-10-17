import { describe, expect, it } from 'vitest';
import { createShape } from '@/store/factories';
import { arcAngles, arrowStrokeWidth, arrowTipLength, innerRadiusOf, nearestSegment, shapeLocalBounds, shapeOutlinePoints, shapeStrokePx, snapDirection } from './shapeGeometry';

describe('shape geometry', () => {
  it('sizes strokes and arrow tips like Manim', () => {
    expect(shapeStrokePx(4, 60)).toBeCloseTo(2.4, 9); // 4 × 0.01 units × 60 px/unit
    expect(shapeStrokePx(0, 60)).toBe(0.75);
    expect(arrowTipLength(4)).toBe(0.35);
    expect(arrowTipLength(1)).toBe(0.25);
    expect(arrowStrokeWidth(6, 2)).toBe(6);
    expect(arrowStrokeWidth(6, 0.5)).toBe(2.5);
  });

  it('bounds each shape tightly around its anchor', () => {
    const rect = { ...createShape(0), shapeType: 'rectangle' as const, width: 4, height: 1 };
    expect(shapeLocalBounds(rect)).toEqual({ left: -2, right: 2, bottom: -0.5, top: 0.5 });
    const line = { ...createShape(0), shapeType: 'line' as const, endX: 2, endY: -1 };
    expect(shapeLocalBounds(line)).toEqual({ left: -1, right: 1, bottom: -0.5, top: 0.5 });
    const poly = { ...createShape(0), shapeType: 'polyline' as const, points: [{ x: 0, y: 0 }, { x: 2, y: 1 }, { x: 1, y: -1 }] };
    expect(shapeLocalBounds(poly)).toEqual({ left: 0, right: 2, bottom: -1, top: 1 });
  });

  it('snaps a direction to 15° steps and finds the nearest segment', () => {
    const s = snapDirection({ x: 0, y: 0 }, { x: 1, y: 0.1 });
    expect(s.y).toBeCloseTo(0, 9);
    expect(s.x).toBeCloseTo(Math.hypot(1, 0.1), 9);
    const d = snapDirection({ x: 0, y: 0 }, { x: 1, y: 0.95 });
    expect(Math.atan2(d.y, d.x)).toBeCloseTo(Math.PI / 4, 9);
    expect(nearestSegment([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], { x: 1.1, y: 0.6 })).toBe(1);
    expect(nearestSegment([{ x: 0, y: 0 }], { x: 0, y: 0 })).toBe(-1);
  });
});

describe('arcs', () => {
  it('keeps the turn within ±360° and never zero', () => {
    expect(arcAngles({})).toEqual({ start: 0, sweep: 90 });
    expect(arcAngles({ startAngleDeg: 10, angleDeg: 900 })).toEqual({ start: 10, sweep: 360 });
    expect(arcAngles({ angleDeg: 0 }).sweep).toBeGreaterThan(0);
  });

  it('bounds an arc by its points, not its full circle', () => {
    const b = shapeLocalBounds({ ...createShape(0), shapeType: 'arc', radius: 1, startAngleDeg: 0, angleDeg: 90 });
    expect(b.left).toBeCloseTo(0);
    expect(b.bottom).toBeCloseTo(0);
    expect(b.right).toBeCloseTo(1);
    expect(b.top).toBeCloseTo(1);
  });

  it('closes a sector through the centre, or through the inner arc when annular', () => {
    const pie = shapeOutlinePoints({ ...createShape(0), shapeType: 'sector', radius: 1, angleDeg: 90 })!;
    expect(pie[pie.length - 1]).toEqual({ x: 0, y: 0 });
    const part = shapeOutlinePoints({ ...createShape(0), shapeType: 'sector', radius: 1, innerRadius: 0.5, angleDeg: 90 })!;
    const last = part[part.length - 1]!;
    expect(Math.hypot(last.x, last.y)).toBeCloseTo(0.5);
    expect(last.x).toBeCloseTo(0.5);
  });

  it('defaults a ring to half its radius and keeps the inner radius below the outer', () => {
    expect(innerRadiusOf({ shapeType: 'annulus', radius: 2 })).toBe(1);
    expect(innerRadiusOf({ shapeType: 'sector', radius: 2 })).toBe(0);
    expect(innerRadiusOf({ shapeType: 'annulus', radius: 1, innerRadius: 5 })).toBeLessThan(1);
  });
});
