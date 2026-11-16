import { describe, expect, it } from 'vitest';
import { createAxes, defaultSceneDefaults } from '@/store/factories';
import {
  axesCreatePartProgress,
  axesCreatePlan,
  estimateLabelGlyphs,
  manimAxisNumberText,
  manimAxisTickValues,
  manimSmooth,
} from './axesCreatePlan';

// Expected values were measured with Manim 0.20.1 (`Axes(...).family_members_with_points()`).
describe('manimAxisTickValues', () => {
  it('skips the origin tick and, with a tip, the max end', () => {
    expect(manimAxisTickValues([-5, 5, 1], true)).toEqual([-5, -4, -3, -2, -1, 1, 2, 3, 4]);
    expect(manimAxisTickValues([-3, 3, 1], true)).toEqual([-3, -2, -1, 1, 2]);
    expect(manimAxisTickValues([-1, 1, 0.5], true)).toEqual([-1, -0.5, 0.5]);
    expect(manimAxisTickValues([0, 12, 2], true)).toEqual([2, 4, 6, 8, 10]);
  });

  it('keeps the max end without a tip', () => {
    expect(manimAxisTickValues([0, 8, 1], false)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('uses a plain range when the axis does not cross zero', () => {
    expect(manimAxisTickValues([1, 5, 1], true)).toEqual([1, 2, 3, 4]);
  });
});

describe('manimAxisNumberText', () => {
  it('takes decimal places from the step', () => {
    expect(manimAxisNumberText(-1, 0.5)).toBe('-1.0');
    expect(manimAxisNumberText(0.5, 0.5)).toBe('0.5');
    expect(manimAxisNumberText(10, 2)).toBe('10');
  });
});

describe('estimateLabelGlyphs', () => {
  it('counts glyphs of plain, math and Hebrew labels', () => {
    expect(estimateLabelGlyphs('x')).toBe(1);
    expect(estimateLabelGlyphs('f(x)')).toBe(4);
    expect(estimateLabelGlyphs('$t^2$')).toBe(2);
    expect(estimateLabelGlyphs('זמן')).toBe(3);
    expect(estimateLabelGlyphs('$\\theta$')).toBe(1);
  });
});

describe('axesCreatePlan', () => {
  it('matches the Manim family order and size of default axes with labels', () => {
    const axes = createAxes(defaultSceneDefaults(), 0);
    const plan = axesCreatePlan(axes);
    // 18 axes members (x line, tip, 9 ticks, y line, tip, 5 ticks) + "x" + "y".
    expect(plan.members).toBe(20);
    expect(plan.parts.map((p) => p.role).slice(0, 3)).toEqual(['xLine', 'xTip', 'xTick']);
    expect(plan.parts.find((p) => p.role === 'yLine')!.first).toBe(11);
    expect(plan.parts.at(-1)).toMatchObject({ role: 'yLabel', first: 19, count: 1 });
  });

  it('counts number glyphs (Manim: 40 members with numbers, no labels)', () => {
    const axes = createAxes(defaultSceneDefaults(), 0);
    axes.includeNumbers = true;
    axes.xLabel = '';
    axes.yLabel = '';
    expect(axesCreatePlan(axes).members).toBe(40);
  });

  it('gives each member an equal smooth slice', () => {
    const axes = createAxes(defaultSceneDefaults(), 0);
    const plan = axesCreatePlan(axes);
    const first = plan.parts[0]!;
    const second = plan.parts[1]!;
    expect(axesCreatePartProgress(first, plan.members, 0.5 / plan.members)).toBeCloseTo(0.5);
    expect(axesCreatePartProgress(second, plan.members, 0.5 / plan.members)).toBe(0);
    expect(axesCreatePartProgress(first, plan.members, 1 / plan.members)).toBe(1);
  });
});

describe('manimSmooth', () => {
  it('matches Manim smooth at sample points', () => {
    expect(manimSmooth(0)).toBe(0);
    expect(manimSmooth(0.5)).toBeCloseTo(0.5);
    expect(manimSmooth(1)).toBe(1);
    // manim.utils.rate_functions.smooth(0.25) = 0.0701...
    expect(manimSmooth(0.25)).toBeCloseTo(0.0701, 3);
  });
});
