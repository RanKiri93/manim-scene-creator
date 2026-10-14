import { describe, expect, it } from 'vitest';
import {
  remapFragmentItemsInPlace,
  collectCodegenIdsFromItems,
  fragmentEarliestStart,
  applyTimeShiftToFragment,
} from '@/lib/projectFragment';
import type { AudioTrackItem, CameraMoveItem, SceneItem } from '@/types/scene';
import { FRAME_W } from '@/lib/constants';

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
  it('keeps graph-follow dot and plot references together and rejects partial fragments', () => {
    const dot = { kind: 'graphDot', id: 'dot', label: '', layer: 0, startTime: 0, duration: 1, x: 0, y: 0, scale: 1, posSteps: [{ kind: 'absolute' }], axesId: 'ax1', dot: { id: 'dot-data', dx: 0, dy: 0, color: '#fff', radius: .1, label: '', labelDir: 'UP' } } as unknown as SceneItem;
    const follow = { kind: 'target_animation', id: 'follow', label: '', layer: 0, startTime: 1, duration: 1, mode: 'graphFollow', targets: [{ targetId: 'dot', graphPlotId: 'plot1', targetX: 2, easing: 'smooth' }] } as unknown as SceneItem;
    const items = [axes('ax1'), plot('ax1', 'plot1', 'fn1'), dot, follow];
    remapFragmentItemsInPlace(items, [], new Set());
    const copied = items.find((it) => it.kind === 'target_animation');
    const copiedDot = items.find((it) => it.kind === 'graphDot');
    if (copied?.kind !== 'target_animation' || copiedDot?.kind !== 'graphDot') throw new Error('Expected copied graph items');
    expect(copied.targets[0]?.targetId).toBe(copiedDot.id);
    expect(copied.targets[0]?.graphPlotId).toBe(items.find((it) => it.kind === 'graphPlot')?.id);
    expect(() => remapFragmentItemsInPlace([follow], [], new Set())).toThrow(/include its referenced dot and source/);
  });
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

  it('remaps attached function sources and rejects a fragment that omits its source', () => {
    const attached = { kind: 'graphDot', id: 'attached', label: '', layer: 0, startTime: 0, duration: 1, x: 0, y: 0, scale: 1, posSteps: [{ kind: 'absolute' }], axesId: 'ax1', dot: { id: 'attached-data', dx: 0, dy: 0, color: '#fff', radius: .1, label: '', labelDir: 'UP', attachment: { kind: 'function', graphPlotId: 'plot1', x: 1 } } } as unknown as SceneItem;
    const items = [axes('ax1'), plot('ax1', 'plot1', 'fn1'), attached];
    remapFragmentItemsInPlace(items, [], new Set());
    const copiedDot = items.find((item) => item.kind === 'graphDot');
    const copiedPlot = items.find((item) => item.kind === 'graphPlot');
    if (copiedDot?.kind !== 'graphDot' || copiedPlot?.kind !== 'graphPlot') throw new Error('Missing remapped attachment items');
    expect(copiedDot.dot.attachment).toMatchObject({ kind: 'function', graphPlotId: copiedPlot.id, x: 1 });
    expect(() => remapFragmentItemsInPlace([attached], [], new Set())).toThrow(/include its referenced graph source/);
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

function camera(id: string, startTime: number): CameraMoveItem {
  return {
    kind: 'camera_move',
    id,
    label: '',
    layer: 0,
    startTime,
    duration: 1,
    targetFrameId: 'frame-2',
    targetWidth: 4.5,
  };
}

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

  it('shifts camera time while preserving width and explicit target', () => {
    const items = [camera('cam', 5)] as SceneItem[];
    applyTimeShiftToFragment(items, [], 10);
    const moved = items[0] as CameraMoveItem;
    expect(moved.startTime).toBe(15);
    expect(moved.targetFrameId).toBe('frame-2');
    expect(moved.targetWidth).toBe(4.5);
    expect(FRAME_W).toBeGreaterThan(4.5);
  });
});
