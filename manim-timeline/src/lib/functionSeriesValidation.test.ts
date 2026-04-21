import { describe, expect, it } from 'vitest';
import type {
  AxesItem,
  GraphFunctionSeriesItem,
  ItemId,
  SceneItem,
} from '@/types/scene';
import { validateFunctionSeries } from '@/lib/functionSeriesValidation';

function axes(id: string): AxesItem {
  return {
    kind: 'axes',
    id,
    label: id,
    layer: 0,
    startTime: 0,
    duration: 4,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    xRange: [-5, 5, 1],
    yRange: [-5, 5, 1],
    xLabel: 'x',
    yLabel: 'y',
    includeNumbers: true,
    includeTip: true,
    scaleX: 1,
    scaleY: 1,
  };
}

function fs(
  id: string,
  axesId: ItemId,
  over: Partial<GraphFunctionSeriesItem> = {},
): GraphFunctionSeriesItem {
  return {
    kind: 'graphFunctionSeries',
    id,
    label: id,
    layer: 0,
    startTime: 0,
    duration: 0,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    axesId,
    jsExpr: 'Math.sin(n * x)',
    pyExpr: 'np.sin(n * x)',
    nMin: 1,
    nMax: 3,
    mode: 'accumulation',
    xDomain: null,
    defaults: {
      color: '#ff0000',
      strokeWidth: 2,
      lineStyle: 'solid',
      animDuration: 1,
      waitAfter: 0.5,
    },
    perN: {},
    ...over,
  };
}

function mapWith(ax: AxesItem): Map<ItemId, SceneItem> {
  return new Map([[ax.id, ax as SceneItem]]);
}

describe('validateFunctionSeries', () => {
  it('passes for a well-formed series', () => {
    const ax = axes('ax');
    const item = fs('s', ax.id);
    const v = validateFunctionSeries(item, mapWith(ax));
    expect(v.topLevelError).toBeNull();
    expect(Object.keys(v.perNErrors)).toHaveLength(0);
  });

  it('flags nMin >= nMax as a top-level error', () => {
    const ax = axes('ax');
    const item = fs('s', ax.id, { nMin: 5, nMax: 3 });
    const v = validateFunctionSeries(item, mapWith(ax));
    expect(v.topLevelError).toMatch(/n_min/i);
  });

  it('flags syntax errors at top level', () => {
    const ax = axes('ax');
    const item = fs('s', ax.id, { jsExpr: '((((' });
    const v = validateFunctionSeries(item, mapWith(ax));
    expect(v.topLevelError).toMatch(/syntax/i);
  });

  it('flags per-n error when expression is non-finite everywhere for that n', () => {
    const ax = axes('ax');
    const item = fs('s', ax.id, {
      // Division by n: for n = 0, result is always non-finite.
      jsExpr: '1 / (n - 1)',
      nMin: 0,
      nMax: 2,
    });
    const v = validateFunctionSeries(item, mapWith(ax));
    expect(v.topLevelError).toBeNull();
    expect(v.perNErrors['1']).toBeDefined();
  });

  it('accepts functions with isolated singularities', () => {
    // 1/(x - n) has exactly one bad point per n; probes cover many x.
    const ax = axes('ax');
    const item = fs('s', ax.id, {
      jsExpr: '1 / (x - n)',
      nMin: 1,
      nMax: 3,
    });
    const v = validateFunctionSeries(item, mapWith(ax));
    expect(v.topLevelError).toBeNull();
    expect(Object.keys(v.perNErrors)).toHaveLength(0);
  });
});
