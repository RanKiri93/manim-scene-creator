import { describe, expect, it } from 'vitest';
import { createGraphArea } from '@/store/factories';
import type { GraphAreaItem, ItemId, SceneItem } from '@/types/scene';
import { fillWithAlpha, riemannPhase, riemannRects, riemannSum, type RiemannMode } from './riemann';
import { manimSmoothProgress } from './visualPlaybackPreview';

const sq = (x: number) => x * x;

describe('Riemann rectangles', () => {
  it('samples left ends, midpoints or right ends', () => {
    expect(riemannSum(riemannRects(sq, 0, 3, 3, 'left'))).toBeCloseTo(5, 12);
    expect(riemannSum(riemannRects(sq, 0, 3, 3, 'middle'))).toBeCloseTo(8.75, 12);
    expect(riemannSum(riemannRects(sq, 0, 3, 3, 'right'))).toBeCloseTo(14, 12);
    expect(riemannRects(sq, 0, 3, 3, 'left')).toEqual([
      { x0: 0, x1: 1, h: 0 },
      { x0: 1, x1: 2, h: 1 },
      { x0: 2, x1: 3, h: 4 },
    ]);
  });

  it('always draws exactly n rectangles ending at xMax, and approaches the integral', () => {
    const rects = riemannRects(sq, 1, 1.3, 3, 'left');
    expect(rects).toHaveLength(3);
    expect(rects.at(-1)!.x1).toBe(1.3);
    expect(Math.abs(riemannSum(riemannRects(sq, 0, 3, 200, 'middle')) - 9)).toBeLessThan(1e-3);
  });

  it('turns a hex colour into an rgba fill', () => {
    expect(fillWithAlpha('#3b82f6', 0.5)).toBe('rgba(59, 130, 246, 0.5)');
    expect(fillWithAlpha('#fff', 2)).toBe('rgba(255, 255, 255, 1)');
  });
});

describe('Riemann phase', () => {
  const area = (): GraphAreaItem & { mode: RiemannMode } => ({
    ...createGraphArea('ax', 2),
    id: 'r',
    duration: 3,
    mode: { areaKind: 'riemann', xMin: 0, xMax: 1, curve: { sourceKind: 'expr', jsExpr: 'x', pyExpr: 'x' }, rule: 'left', counts: [2, 4, 8] },
  });
  const items = (a: GraphAreaItem) => new Map<ItemId, SceneItem>([[a.id, a]]);

  it('splits the clip evenly: fade in the first count, then each replaces the last', () => {
    const a = area();
    expect(riemannPhase(a, 1.9, items(a))).toBeNull();
    expect(riemannPhase(a, 2.5, items(a))).toEqual({ from: null, to: 0, progress: manimSmoothProgress(0.5) });
    expect(riemannPhase(a, 3.25, items(a))).toEqual({ from: 0, to: 1, progress: manimSmoothProgress(0.25) });
    expect(riemannPhase(a, 4.75, items(a))!.from).toBe(1);
    expect(riemannPhase(a, 9, items(a))).toEqual({ from: null, to: 2, progress: 1 });
  });
});
