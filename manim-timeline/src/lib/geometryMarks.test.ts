import { describe, expect, it } from 'vitest';
import { createShape } from '@/store/factories';
import type { FrameDef, ItemId, SceneItem, ShapeItem } from '@/types/scene';
import { ANGLE_MARK_SEGMENTS, angleMarkStaticGeometry, boundShapeReferencedIds, isAngleMark, resolveAngleMark, tickSegments } from './shapeAnchors';
import { remapSceneItem } from './projectFragment';
import { canBeTargetAnimationTarget } from './time';

const frames: FrameDef[] = [{ id: 'home', col: 0, row: 0 }];
const ctx = (items: Map<ItemId, SceneItem>, time = 0) => ({ items, time, frames, startFrameId: 'home' });

function mark(angle: ShapeItem['angle']): ShapeItem {
  return { ...createShape(0), id: 'm', shapeType: 'polyline', angle };
}
const pt = (x: number, y: number) => ({ kind: 'point' as const, x, y });

describe('angle marks', () => {
  it('draws a square at a right angle and an arc otherwise, with degrees and a label spot', () => {
    const items = new Map<ItemId, SceneItem>();
    const right = resolveAngleMark(mark({ vertex: pt(0, 0), from: pt(2, 0), to: pt(0, 3), radius: 0.5 }), ctx(items));
    expect(right.error).toBeNull();
    if (right.error != null) return;
    expect(right.right).toBe(true);
    expect(right.degrees).toBeCloseTo(90, 9);
    expect(right.points).toEqual([{ x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0.5 }]);
    const arc = resolveAngleMark(mark({ vertex: pt(1, 1), from: pt(3, 1), to: pt(2, 2), radius: 0.5 }), ctx(items));
    if (arc.error != null) throw new Error(arc.error);
    expect(arc.right).toBe(false);
    expect(arc.degrees).toBeCloseTo(45, 9);
    expect(arc.points).toHaveLength(ANGLE_MARK_SEGMENTS + 1);
    for (const q of arc.points) expect(Math.hypot(q.x - 1, q.y - 1)).toBeCloseTo(0.5, 9);
    expect(arc.points.at(-1)!.x).toBeCloseTo(1 + 0.5 * Math.SQRT1_2, 9);
    // Label on the bisector (22.5°) at 1.8 × radius.
    expect(arc.labelAt.x).toBeCloseTo(1 + 0.9 * Math.cos(Math.PI / 8), 9);
    // Clockwise arms take the smaller angle the other way round.
    const cw = resolveAngleMark(mark({ vertex: pt(0, 0), from: pt(1, 0), to: pt(1, -1), radius: 1 }), ctx(items));
    if (cw.error != null) throw new Error(cw.error);
    expect(cw.points.at(-1)!.y).toBeCloseTo(-Math.SQRT1_2, 9);
  });

  it('forces an arc or a square, and reports an arm of zero length', () => {
    const items = new Map<ItemId, SceneItem>();
    const forced = resolveAngleMark(mark({ vertex: pt(0, 0), from: pt(1, 0), to: pt(0, 1), radius: 0.5, mark: 'arc' }), ctx(items));
    expect(forced.error == null && forced.right).toBe(false);
    expect(resolveAngleMark(mark({ vertex: pt(0, 0), from: pt(0, 0), to: pt(0, 1), radius: 0.5 }), ctx(items)).error).toMatch(/zero length/);
  });

  it('follows objects, bakes static points, lists and remaps its references, and only takes colour animations', () => {
    const a: ShapeItem = { ...createShape(0), id: 'A', shapeType: 'circle', x: 1, y: 0, radius: 0.06 };
    const items = new Map<ItemId, SceneItem>([[a.id, a]]);
    const m = mark({ vertex: pt(0, 0), from: { kind: 'object', itemId: 'A' }, to: pt(0, 1), radius: 0.5 });
    expect(isAngleMark(m)).toBe(true);
    expect(boundShapeReferencedIds(m)).toEqual(['A']);
    const g = angleMarkStaticGeometry(m, ctx(items))!;
    expect(g).toMatchObject({ x: 0, y: 0, points: [{ x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0.5 }] });
    expect(canBeTargetAnimationTarget(m, 'move')).toBe(false);
    expect(canBeTargetAnimationTarget(m, 'color')).toBe(true);
    remapSceneItem(m, new Map([['A', 'A2']]));
    expect(m.angle!.from).toEqual({ kind: 'object', itemId: 'A2', edge: undefined });
  });
});

describe('equal-length ticks', () => {
  it('puts 1–3 short marks across the middle, perpendicular to the segment', () => {
    expect(tickSegments({ x: 0, y: 0 }, { x: 2, y: 0 }, 0)).toEqual([]);
    const one = tickSegments({ x: 0, y: 0 }, { x: 2, y: 0 }, 1);
    expect(one).toEqual([[{ x: 1, y: -0.12 }, { x: 1, y: 0.12 }]]);
    const two = tickSegments({ x: 0, y: 0 }, { x: 0, y: 2 }, 2);
    expect(two.map(([p]) => p.y)).toEqual([0.96, 1.04]);
    expect(two[0]![0].x).toBeCloseTo(0.12, 12);
  });
});
