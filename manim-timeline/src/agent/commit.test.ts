import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from '@/store/useSceneStore';
import type { GraphFunctionSeriesItem } from '@/types/scene';
import { commitActions } from './commit';

function makeAxes(id: string) {
  useSceneStore.getState().addItem({
    id,
    kind: 'axes',
    label: '',
    layer: 0,
    startTime: 0,
    duration: 2,
    x: 0,
    y: 0,
    scale: 1,
    scaleX: 1,
    scaleY: 1,
    posSteps: [{ kind: 'absolute' }],
    audioTrackId: null,
    xRange: [-5, 5, 1],
    yRange: [-3, 3, 1],
    xLabel: 'x',
    yLabel: 'y',
    includeNumbers: false,
    includeTip: true,
  });
}

function makeFunctionSeries(
  id: string,
  axesId: string,
  perN: GraphFunctionSeriesItem['perN'] = {},
) {
  useSceneStore.getState().addItem({
    id,
    kind: 'graphFunctionSeries',
    label: 'series',
    layer: 0,
    startTime: 0,
    duration: 5,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    audioTrackId: null,
    axesId,
    jsExpr: 'Math.sin(n * x)',
    pyExpr: 'np.sin(n * x)',
    nMin: 1,
    nMax: 4,
    mode: 'accumulation',
    displayMode: 'individual',
    xDomain: null,
    defaults: {
      color: '#3b82f6',
      strokeWidth: 4,
      lineStyle: 'solid',
      animDuration: 1,
      waitAfter: 0.3,
    },
    perN,
    perNErrors: {},
    topLevelError: null,
  });
}

function resetStore() {
  useSceneStore.setState((s) => {
    s.items.clear();
    s.selectedIds.clear();
    s.inspectedId = null;
  });
}

describe('commitActions — graphFunctionSeries deep-merge', () => {
  beforeEach(() => {
    resetStore();
  });

  it('merges a perN UPDATE instead of overwriting the dictionary', () => {
    makeAxes('ax1');
    makeFunctionSeries('fs1', 'ax1', {
      '2': { color: '#00FF00', strokeWidth: 6 },
      '5': { color: '#111111' },
    });

    commitActions([
      {
        action: 'UPDATE',
        itemId: 'fs1',
        updates: {
          perN: {
            '3': { color: '#FF0000', waitAfter: 1 },
          },
        },
      } as never,
    ]);

    const fs = useSceneStore.getState().items.get('fs1') as GraphFunctionSeriesItem;
    expect(fs.perN['2']).toEqual({ color: '#00FF00', strokeWidth: 6 });
    expect(fs.perN['3']).toEqual({ color: '#FF0000', waitAfter: 1 });
    expect(fs.perN['5']).toEqual({ color: '#111111' });
  });

  it('merges fields within a single perN entry (keeps user-set strokeWidth)', () => {
    makeAxes('ax1');
    makeFunctionSeries('fs1', 'ax1', {
      '3': { color: '#00FF00', strokeWidth: 8, lineStyle: 'dashed' },
    });

    commitActions([
      {
        action: 'UPDATE',
        itemId: 'fs1',
        updates: {
          perN: { '3': { color: '#FF0000' } },
        },
      } as never,
    ]);

    const fs = useSceneStore.getState().items.get('fs1') as GraphFunctionSeriesItem;
    expect(fs.perN['3']).toEqual({
      color: '#FF0000',
      strokeWidth: 8,
      lineStyle: 'dashed',
    });
  });

  it('shallow-merges defaults so unspecified fields are preserved', () => {
    makeAxes('ax1');
    makeFunctionSeries('fs1', 'ax1');

    commitActions([
      {
        action: 'UPDATE',
        itemId: 'fs1',
        updates: {
          defaults: { color: '#ABCDEF' } as never,
        },
      } as never,
    ]);

    const fs = useSceneStore.getState().items.get('fs1') as GraphFunctionSeriesItem;
    expect(fs.defaults).toMatchObject({
      color: '#ABCDEF',
      strokeWidth: 4,
      lineStyle: 'solid',
      animDuration: 1,
      waitAfter: 0.3,
    });
  });

  it('updates scalar top-level fields normally', () => {
    makeAxes('ax1');
    makeFunctionSeries('fs1', 'ax1', { '3': { color: '#00FF00' } });

    commitActions([
      {
        action: 'UPDATE',
        itemId: 'fs1',
        updates: {
          nMax: 6,
          mode: 'replacement',
        } as never,
      } as never,
    ]);

    const fs = useSceneStore.getState().items.get('fs1') as GraphFunctionSeriesItem;
    expect(fs.nMax).toBe(6);
    expect(fs.mode).toBe('replacement');
    expect(fs.perN['3']).toEqual({ color: '#00FF00' });
  });
});
