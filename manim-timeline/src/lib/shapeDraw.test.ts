import { describe, expect, it } from 'vitest';
import { draggedShapeGeometry, drawsByPoints, nextDrawPoint, pointsShapeGeometry } from './shapeDraw';

const none = { shift: false, alt: false };

describe('drawing shapes by dragging', () => {
  it('fills the dragged box, or grows from the centre with Alt', () => {
    expect(draggedShapeGeometry('rectangle', { x: 0, y: 0 }, { x: 4, y: -2 }, none)).toMatchObject({ x: 2, y: -1, width: 4, height: 2 });
    expect(draggedShapeGeometry('ellipse', { x: 1, y: 1 }, { x: 2, y: 1.5 }, { shift: false, alt: true })).toMatchObject({ x: 1, y: 1, width: 2, height: 1 });
  });

  it('keeps Shift boxes square and circles round', () => {
    expect(draggedShapeGeometry('rectangle', { x: 0, y: 0 }, { x: 3, y: 1 }, { shift: true, alt: false })).toMatchObject({ width: 3, height: 3, x: 1.5, y: 1.5 });
    expect(draggedShapeGeometry('circle', { x: 0, y: 0 }, { x: -2, y: 1 }, none)).toMatchObject({ x: -1, y: 1, radius: 1 });
    expect(draggedShapeGeometry('regularPolygon', { x: 0, y: 0 }, { x: 2, y: 2 }, none)).toMatchObject({ radius: 1 });
  });

  it('runs two-point shapes from start to end, Shift snapping to 45°', () => {
    expect(draggedShapeGeometry('arrow', { x: 0, y: 0 }, { x: 2, y: 1 }, none)).toMatchObject({ x: 1, y: 0.5, endX: 2, endY: 1 });
    const snapped = draggedShapeGeometry('brace', { x: 0, y: 0 }, { x: 2, y: 0.3 }, { shift: true, alt: false });
    expect(snapped.endY).toBeCloseTo(0);
    expect(snapped.endX).toBeCloseTo(Math.hypot(2, 0.3));
  });

  it('drags arcs out from their centre, pointing at the middle of a quarter turn', () => {
    expect(draggedShapeGeometry('sector', { x: 1, y: 1 }, { x: 1, y: 3 }, none)).toMatchObject({ x: 1, y: 1, radius: 2, startAngleDeg: 45, angleDeg: 90 });
    expect(draggedShapeGeometry('annulus', { x: 0, y: 0 }, { x: 3, y: 4 }, none)).toMatchObject({ radius: 5, innerRadius: 2.5 });
  });
});

describe('drawing shapes by points', () => {
  it('is used for polylines and polygons only', () => {
    expect(drawsByPoints('polyline')).toBe(true);
    expect(drawsByPoints('polygon')).toBe(true);
    expect(drawsByPoints('rectangle')).toBe(false);
  });

  it('anchors the points at the middle of their box and drops double-click repeats', () => {
    const g = pointsShapeGeometry('polygon', [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 4, y: 2 }]);
    expect(g).toMatchObject({ x: 2, y: 1, points: [{ x: -2, y: -1 }, { x: 2, y: -1 }, { x: 2, y: 1 }] });
    expect(pointsShapeGeometry('polygon', [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 }])).toBeNull();
    expect(pointsShapeGeometry('polyline', [{ x: 0, y: 0 }, { x: 1, y: 0 }])).not.toBeNull();
  });

  it('snaps the next segment to 45° with Shift', () => {
    const p = nextDrawPoint([{ x: 0, y: 0 }], { x: 2, y: 1.8 }, true);
    expect(p.x).toBeCloseTo(p.y);
    expect(nextDrawPoint([], { x: 2, y: 1.8 }, true)).toEqual({ x: 2, y: 1.8 });
  });
});
