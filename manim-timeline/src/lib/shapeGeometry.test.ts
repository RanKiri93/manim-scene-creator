import { describe, expect, it } from 'vitest';
import { createShape } from '@/store/factories';
import { arrowStrokeWidth, arrowTipLength, nearestSegment, shapeLocalBounds, shapeStrokePx, snapDirection } from './shapeGeometry';

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
