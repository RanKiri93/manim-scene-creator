import { describe, expect, it } from 'vitest';
import {
  expandFragmentSelection,
  getDirectItemDeps,
  remapFragmentItemsInPlace,
  collectCodegenIdsFromItems,
  fragmentEarliestStart,
  applyTimeShiftToFragment,
  stripTextLineSegmentTiming,
  buildProjectFragmentFile,
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

describe('getDirectItemDeps', () => {
  it('includes axes for graph plot', () => {
    const p = plot('ax1', 'plot1', 'fn1') as Extract<SceneItem, { kind: 'graphPlot' }>;
    expect(getDirectItemDeps(p)).toContain('ax1');
  });
});

describe('expandFragmentSelection', () => {
  it('pulls axes when only plot is selected', () => {
    const ax = axes('ax1');
    const p = plot('ax1', 'plot1', 'fn1');
    const m = new Map<string, SceneItem>([
      ['ax1', ax],
      ['plot1', p],
    ]);
    const r = expandFragmentSelection(m, [], new Set(['plot1']));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(new Set(r.itemIds)).toEqual(new Set(['ax1', 'plot1']));
  });

  it('errors when reference is missing', () => {
    const p = plot('missing', 'plot1', 'fn1');
    const m = new Map<string, SceneItem>([['plot1', p]]);
    const r = expandFragmentSelection(m, [], new Set(['plot1']));
    expect(r.ok).toBe(false);
  });

  it('includes transform source line', () => {
    const lineA: SceneItem = {
      kind: 'textLine',
      id: 'a',
      label: '',
      layer: 0,
      startTime: 0,
      duration: 2,
      x: 0,
      y: 0,
      scale: 1,
      posSteps: [{ kind: 'absolute' }],
      raw: '',
      font: 'Alef',
      fontSize: 36,
      segments: [],
      measure: null,
      measureError: null,
      previewDataUrl: null,
      segmentMeasures: null,
    };
    const lineB: SceneItem = {
      ...lineA,
      id: 'b',
      transformConfig: {
        sourceLineId: 'a',
        segmentPairs: {},
        unmappedSourceBehavior: 'fade_out',
        unmappedTargetBehavior: 'fade_in',
      },
    };
    const m = new Map<string, SceneItem>([
      ['a', lineA],
      ['b', lineB],
    ]);
    const r = expandFragmentSelection(m, [], new Set(['b']));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(new Set(r.itemIds)).toEqual(new Set(['a', 'b']));
  });

  it('includes linked audio tracks', () => {
    const line: SceneItem = {
      kind: 'textLine',
      id: 'L',
      label: '',
      layer: 0,
      startTime: 0,
      duration: 2,
      x: 0,
      y: 0,
      scale: 1,
      posSteps: [{ kind: 'absolute' }],
      audioTrackId: 'aud1',
      raw: '',
      font: 'Alef',
      fontSize: 36,
      segments: [],
      measure: null,
      measureError: null,
      previewDataUrl: null,
      segmentMeasures: null,
    };
    const audio: AudioTrackItem = {
      id: 'aud1',
      text: 'hi',
      audioUrl: 'http://example.com/a.wav',
      startTime: 0,
      duration: 1,
    };
    const m = new Map<string, SceneItem>([['L', line]]);
    const r = expandFragmentSelection(m, [audio], new Set(['L']));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.audioItems.map((a) => a.id)).toEqual(['aud1']);
  });
});

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

describe('stripTextLineSegmentTiming', () => {
  it('removes waitAfterSec and animSec from text line segments', () => {
    const tl: SceneItem = {
      kind: 'textLine',
      id: 'L',
      label: '',
      layer: 0,
      startTime: 0,
      duration: 2,
      x: 0,
      y: 0,
      scale: 1,
      posSteps: [{ kind: 'absolute' }],
      raw: '',
      font: 'Alef',
      fontSize: 36,
      segments: [
        {
          text: 'a',
          isMath: true,
          color: '#fff',
          bold: false,
          italic: false,
          waitAfterSec: 0.5,
          animSec: 0.3,
        },
      ],
      measure: null,
      measureError: null,
      previewDataUrl: null,
      segmentMeasures: null,
    };
    const items = [tl];
    stripTextLineSegmentTiming(items);
    const seg = (items[0] as Extract<SceneItem, { kind: 'textLine' }>).segments[0]!;
    expect(seg.waitAfterSec).toBeUndefined();
    expect(seg.animSec).toBeUndefined();
  });

  it('is applied when buildProjectFragmentFile stripSegmentTiming is true', () => {
    const tl: SceneItem = {
      kind: 'textLine',
      id: 'L',
      label: '',
      layer: 0,
      startTime: 1,
      duration: 3,
      x: 0,
      y: 0,
      scale: 1,
      posSteps: [{ kind: 'absolute' }],
      raw: '',
      font: 'Alef',
      fontSize: 36,
      segments: [
        {
          text: 'x',
          isMath: true,
          color: '#fff',
          bold: false,
          italic: false,
          waitAfterSec: 2,
          animSec: 1,
        },
      ],
      measure: null,
      measureError: null,
      previewDataUrl: null,
      segmentMeasures: null,
    };
    const frag = buildProjectFragmentFile([tl], [], false, true);
    const seg = frag.items[0]!.kind === 'textLine' ? frag.items[0].segments[0]! : null;
    expect(seg).toBeTruthy();
    expect(seg!.waitAfterSec).toBeUndefined();
    expect(seg!.animSec).toBeUndefined();
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
