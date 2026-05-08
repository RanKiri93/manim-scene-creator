import { describe, expect, it } from 'vitest';
import {
  remapFragmentItemsInPlace,
  collectCodegenIdsFromItems,
  fragmentEarliestStart,
  applyTimeShiftToFragment,
} from '@/lib/projectFragment';
import type { AudioTrackItem, SceneItem } from '@/types/scene';

function axes(id: string): SceneItem {
  return {
    kind: 'axes',
    id,
    label: 'ax',
    layer: 0,
    startTime: 0,
    duration: 10,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    xRange: [-1, 1, 0.5],
    yRange: [-1, 1, 0.5],
    xLabel: 'x',
    yLabel: 'y',
    includeNumbers: true,
    includeTip: true,
    scaleX: 1,
    scaleY: 1,
  };
}

function plot(axesId: string, id: string, fnId: string): SceneItem {
  return {
    kind: 'graphPlot',
    id,
    label: 'p',
    layer: 0,
    startTime: 1,
    duration: 5,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    axesId,
    fn: {
      id: fnId,
      jsExpr: 'x',
      pyExpr: 'x',
      color: '#fff',
      label: 'f',
    },
    xDomain: null,
    strokeWidth: 2,
  };
}

describe('remapFragmentItemsInPlace', () => {
  it('remaps nested graph fn id and axes reference', () => {
    const items = [axes('ax1'), plot('ax1', 'plot1', 'fn1')] as SceneItem[];
    const reserved = new Set<string>(['collision']);
    remapFragmentItemsInPlace(items, [], reserved);
    const ax = items.find((i) => i.kind === 'axes')!;
    const pl = items.find((i) => i.kind === 'graphPlot')!;
    expect(ax.id).not.toBe('ax1');
    expect(pl.id).not.toBe('plot1');
    if (pl.kind !== 'graphPlot') throw new Error('expected plot');
    expect(pl.axesId).toBe(ax.id);
    expect(pl.fn.id).not.toBe('fn1');
  });

  it('remaps graph area plot reference to new plot id', () => {
    const pl = plot('ax1', 'plot1', 'fn1');
    const area: SceneItem = {
      kind: 'graphArea',
      id: 'area1',
      label: '',
      layer: 0,
      startTime: 2,
      duration: 4,
      x: 0,
      y: 0,
      scale: 1,
      posSteps: [{ kind: 'absolute' }],
      axesId: 'ax1',
      mode: {
        areaKind: 'underCurve',
        xMin: 0,
        xMax: 1,
        curve: { sourceKind: 'plot', plotId: 'plot1' },
        showBoundaryPlot: false,
      },
      fillColor: '#000',
      fillOpacity: 0.3,
      strokeColor: '#fff',
      strokeWidth: 0,
    };
    const items = [axes('ax1'), pl, area];
    remapFragmentItemsInPlace(items, [], new Set());
    const ar = items.find((i) => i.kind === 'graphArea')!;
    const pr = items.find((i) => i.kind === 'graphPlot')!;
    if (ar.kind !== 'graphArea' || ar.mode.areaKind !== 'underCurve') throw new Error('shape');
    expect(ar.mode.curve.sourceKind).toBe('plot');
    if (ar.mode.curve.sourceKind !== 'plot') return;
    expect(ar.mode.curve.plotId).toBe(pr.id);
  });
});

describe('collectCodegenIdsFromItems', () => {
  it('collects top-level and nested ids', () => {
    const items = [plot('ax1', 'plot1', 'fn1')];
    const s = collectCodegenIdsFromItems(items);
    expect(s.has('plot1')).toBe(true);
    expect(s.has('fn1')).toBe(true);
  });
});

describe('fragment time shift', () => {
  it('computes earliest start and shifts', () => {
    const items = [axes('a')] as SceneItem[];
    items[0]!.startTime = 5;
    const audio: AudioTrackItem[] = [
      {
        id: 'x',
        text: '',
        audioUrl: '',
        startTime: 3,
        duration: 1,
      },
    ];
    expect(fragmentEarliestStart(items, audio)).toBe(3);
    applyTimeShiftToFragment(items, audio, 10);
    expect(items[0]!.startTime).toBe(15);
    expect(audio[0]!.startTime).toBe(13);
  });
});
