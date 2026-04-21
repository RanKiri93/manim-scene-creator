import { describe, expect, it } from 'vitest';
import type {
  AxesItem,
  GraphFunctionSeriesItem,
  ItemId,
} from '@/types/scene';
import {
  generateGraphFunctionSeriesDef,
  generateGraphFunctionSeriesPlay,
  functionSeriesConcurrentBranch,
  functionSeriesCurveVar,
} from '@/codegen/functionSeriesCodegen';

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

describe('function series codegen', () => {
  it('emits a builder and one VMobject per n in the def block', () => {
    const ax = axes('ax');
    const item = fs('s1', ax.id);
    const code = generateGraphFunctionSeriesDef(item, 'axes_1', 4);
    expect(code).toContain('def axes_1_fs_s1_build(');
    for (const n of [1, 2, 3]) {
      const v = functionSeriesCurveVar('axes_1', item.id, n);
      expect(code).toContain(`${v} = axes_1_fs_s1_build(${n}`);
    }
    expect(code).toContain('axes_1_fs_s1 = VGroup()');
  });

  it('accumulation play emits Create + wait per n (no wait after last)', () => {
    const ax = axes('ax');
    const item = fs('s1', ax.id, { mode: 'accumulation' });
    const code = generateGraphFunctionSeriesPlay(item, 'axes_1', 4, new Map());
    const creates = code.match(/Create\(axes_1_fs_s1_n/g) ?? [];
    expect(creates).toHaveLength(3);
    const waits = code.match(/self\.wait\(/g) ?? [];
    expect(waits).toHaveLength(2);
  });

  it('replacement play emits Create then ReplacementTransform for subsequent n', () => {
    const ax = axes('ax');
    const item = fs('s1', ax.id, { mode: 'replacement' });
    const code = generateGraphFunctionSeriesPlay(item, 'axes_1', 4, new Map());
    const creates = code.match(/Create\(axes_1_fs_s1_n/g) ?? [];
    expect(creates).toHaveLength(1);
    const replacements = code.match(/ReplacementTransform\(/g) ?? [];
    expect(replacements).toHaveLength(2);
  });

  it('concurrent branch returns a Succession containing all n', () => {
    const ax = axes('ax');
    const item = fs('s1', ax.id, { mode: 'accumulation' });
    const branch = functionSeriesConcurrentBranch(item, 'axes_1', 0);
    expect(branch).toMatch(/^Succession\(/);
    expect(
      (branch.match(/Create\(axes_1_fs_s1_n/g) ?? []).length,
    ).toBe(3);
  });

  it('emits empty play for invalid range', () => {
    const ax = axes('ax');
    const item = fs('s1', ax.id, { nMin: 3, nMax: 1 });
    const code = generateGraphFunctionSeriesPlay(item, 'axes_1', 4, new Map());
    expect(code).toBe('');
  });
});

describe('GraphFunctionSeriesItem totals', () => {
  it('functionSeriesIndices excludes boundary when nMin >= nMax', async () => {
    const { functionSeriesIndices } = await import('@/types/scene');
    expect(functionSeriesIndices(fs('s', 'ax', { nMin: 3, nMax: 3 }))).toEqual(
      [],
    );
    expect(functionSeriesIndices(fs('s', 'ax', { nMin: -2, nMax: 1 }))).toEqual(
      [-2, -1, 0, 1],
    );
  });

  it('functionSeriesTotalDuration sums anim and wait but skips last wait', async () => {
    const { functionSeriesTotalDuration } = await import('@/types/scene');
    const item = fs('s', 'ax', {
      nMin: 0,
      nMax: 2,
      defaults: {
        color: '#000',
        strokeWidth: 2,
        lineStyle: 'solid',
        animDuration: 1,
        waitAfter: 0.5,
      },
    });
    // 3 curves: 1 + 0.5 + 1 + 0.5 + 1 = 4
    expect(functionSeriesTotalDuration(item)).toBeCloseTo(4, 6);
  });
});