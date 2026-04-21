import { describe, expect, it } from 'vitest';
import {
  flattenExportLeaves,
  reorderExportLeavesForPlacementDeps,
} from '@/codegen/flattenExport';
import type { AxesItem, SceneItem, TextLineItem } from '@/types/scene';

function line(
  id: string,
  startTime: number,
  layer: number,
  refId: string | null,
): TextLineItem {
  return {
    kind: 'textLine',
    id,
    label: id,
    layer,
    startTime,
    duration: 2,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: refId
      ? [
          {
            kind: 'next_to',
            refKind: 'line',
            refId,
            dir: 'RIGHT',
            buff: 0.2,
            alignedEdge: null,
            refSegmentIndex: null,
            selfSegmentIndex: null,
            bounds: null,
          },
        ]
      : [{ kind: 'absolute' }],
    raw: '',
    font: 'Alef',
    fontSize: 36,
    segments: [{ text: 'x', isMath: true, color: '#fff', bold: false, italic: false }],
    measure: null,
    measureError: null,
    previewDataUrl: null,
    segmentMeasures: null,
  };
}

function axes(id: string, startTime: number, layer: number): AxesItem {
  return {
    kind: 'axes',
    id,
    label: id,
    layer,
    startTime,
    duration: 8,
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

describe('reorderExportLeavesForPlacementDeps', () => {
  it('orders concurrent next_to reference before dependent when layer order was wrong', () => {
    const ref = line('ref', 0, 1, null);
    const dep = line('dep', 0, 0, 'ref');
    const ordered = reorderExportLeavesForPlacementDeps([dep, ref]);
    expect(ordered.map((l) => l.id)).toEqual(['ref', 'dep']);
  });

  it('is applied inside flattenExportLeaves', () => {
    const items: SceneItem[] = [
      line('StepA', 0, 0, 'sOHtHnd38NAL'),
      line('sOHtHnd38NAL', 0, 1, null),
    ];
    const flat = flattenExportLeaves(items);
    expect(flat.map((l) => l.id)).toEqual(['sOHtHnd38NAL', 'StepA']);
  });

  it('keeps strict timeline: later clip after earlier even if next_to points backward (cycle throws)', () => {
    const early = line('early', 0, 0, null);
    const late = line('late', 5, 0, 'early');
    const flat = flattenExportLeaves([early, late]);
    expect(flat.map((l) => l.id)).toEqual(['early', 'late']);
  });

  it('throws when next_to contradicts timeline order (cycle)', () => {
    const early = line('early', 5, 0, null);
    const late = line('late', 0, 0, 'early');
    expect(() => reorderExportLeavesForPlacementDeps([early, late])).toThrow(
      /cycle/i,
    );
  });

  it('places axes before graph plot at same start time', () => {
    const ax = axes('ax', 0, 1);
    const plot: SceneItem = {
      kind: 'graphPlot',
      id: 'plot',
      label: '',
      layer: 0,
      startTime: 0,
      duration: 4,
      x: 0,
      y: 0,
      scale: 1,
      posSteps: [{ kind: 'absolute' }],
      axesId: 'ax',
      fn: { id: 'fn1', jsExpr: 'x', pyExpr: 'x', color: '#fff', label: '' },
      xDomain: null,
      strokeWidth: 2,
    };
    const flat = reorderExportLeavesForPlacementDeps([plot, ax]);
    const axIdx = flat.findIndex((l) => l.id === 'ax');
    const plotIdx = flat.findIndex((l) => l.id === 'plot');
    expect(axIdx).toBeLessThan(plotIdx);
  });
});
