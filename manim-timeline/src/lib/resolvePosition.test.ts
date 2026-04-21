import { describe, expect, it } from 'vitest';
import {
  getItemSurroundBBox,
  resolvePosition,
  resolvePositionOrAxesAnchor,
} from '@/lib/resolvePosition';
import type {
  AxesItem,
  GraphDotItem,
  ShapeItem,
  SceneItem,
  ItemId,
} from '@/types/scene';

function shape(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  posSteps: ShapeItem['posSteps'],
): ShapeItem {
  return {
    kind: 'shape',
    id,
    label: id,
    layer: 0,
    startTime: 0,
    duration: 1,
    x,
    y,
    scale: 1,
    posSteps,
    audioTrackId: null,
    shapeType: 'rectangle',
    rotationDeg: 0,
    radius: 0.2,
    width: w,
    height: h,
    endX: 1,
    endY: 0,
    strokeColor: '#fff',
    strokeWidth: 2,
    fillColor: null,
    fillOpacity: 0,
    introStyle: 'fade_in',
  };
}

function mapOf(...items: SceneItem[]): Map<ItemId, SceneItem> {
  return new Map(items.map((it) => [it.id, it]));
}

describe('resolvePosition next_to', () => {
  it('resolves chain with aligned_edge', () => {
    const a = shape('a', 0, 1, 2, 2, [{ kind: 'absolute' }]);
    const b = shape(
      'b',
      0,
      0,
      2,
      2,
      [
        { kind: 'absolute' },
        {
          kind: 'next_to',
          refKind: 'shape',
          refId: 'a',
          dir: 'DOWN',
          buff: 0,
          alignedEdge: 'RIGHT',
          refSegmentIndex: null,
          selfSegmentIndex: null,
          bounds: null,
        },
      ],
    );
    const m = mapOf(a, b);
    const p = resolvePosition(b, m);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(-1);
  });
});

describe('resolvePositionOrAxesAnchor', () => {
  it('uses axes center for graph overlays (matches canvas GraphNode)', () => {
    const axes: AxesItem = {
      kind: 'axes',
      id: 'ax1',
      label: '',
      layer: 0,
      startTime: 0,
      duration: 1,
      x: 2,
      y: 3,
      scale: 1,
      scaleX: 1,
      scaleY: 1,
      posSteps: [{ kind: 'absolute' }],
      audioTrackId: null,
      xRange: [-1, 1, 1],
      yRange: [-1, 1, 1],
      xLabel: '',
      yLabel: '',
      includeNumbers: false,
      includeTip: true,
    };
    const dot: GraphDotItem = {
      kind: 'graphDot',
      id: 'd1',
      label: '',
      layer: 0,
      startTime: 0,
      duration: 1,
      x: 0,
      y: 0,
      scale: 1,
      posSteps: [{ kind: 'absolute' }],
      audioTrackId: null,
      axesId: 'ax1',
      dot: {
        id: 'dp',
        dx: 0,
        dy: 0,
        color: '#fff',
        radius: 0.08,
        label: '',
        labelDir: 'UP',
      },
    };
    const m = mapOf(axes, dot);
    expect(resolvePosition(dot, m)).toEqual({ x: 0, y: 0 });
    expect(resolvePositionOrAxesAnchor(dot, m)).toEqual({ x: 2, y: 3 });
    const bbDot = getItemSurroundBBox(dot, m);
    const bbAx = getItemSurroundBBox(axes, m);
    expect(bbDot.w).toBeCloseTo(bbAx.w);
    expect(bbDot.h).toBeCloseTo(bbAx.h);
  });
});
