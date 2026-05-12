import { describe, expect, it } from 'vitest';
import {
  getItemSurroundBBox,
  getItemBBox,
  resolvePosition,
  resolvePositionOrAxesAnchor,
} from '@/lib/resolvePosition';
import type {
  AxesItem,
  GraphDotItem,
  MeasureResult,
  ShapeItem,
  SceneItem,
  ItemId,
  TextLineItem,
} from '@/types/scene';
import { FRAME_H, FRAME_W } from '@/lib/constants';

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
    points: [
      { x: -1, y: 0 },
      { x: 0, y: 0.75 },
      { x: 1, y: 0 },
    ],
    tailArrow: false,
    headArrow: false,
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

const measuredLine: MeasureResult = {
  width: 4,
  height: 1,
  widthInk: 2,
  heightInk: 0.5,
  offsetInkX: 0.5,
  offsetInkY: 0.1,
  inkLeftX: -0.5,
  inkRightX: 1.5,
  inkTopY: 0.35,
  inkBottomY: -0.15,
  bboxLeft: -2,
  bboxRight: 2,
  bboxTop: 0.5,
  bboxBottom: -0.5,
  pngBase64: null,
  pngWidth: null,
  pngHeight: null,
  segmentMeasures: null,
  mathChildMeasures: null,
};

function textLine(posSteps: TextLineItem['posSteps']): TextLineItem {
  return {
    kind: 'textLine',
    id: 'line',
    label: 'line',
    layer: 0,
    startTime: 0,
    duration: 1,
    x: 0,
    y: 0,
    scale: 1,
    posSteps,
    audioTrackId: null,
    raw: 'שלום',
    font: 'Alef',
    fontSize: 36,
    segments: [{ text: 'שלום', isMath: false, color: '#ffffff', bold: false, italic: false }],
    measure: measuredLine,
    measureError: null,
    previewDataUrl: null,
    segmentMeasures: null,
    mathChildMeasures: null,
  };
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

  it('lets a later absolute step reset prior relative placement', () => {
    const a = shape('a', 0, 1, 2, 2, [{ kind: 'absolute' }]);
    const b = shape(
      'b',
      2,
      -3,
      2,
      2,
      [
        {
          kind: 'next_to',
          refKind: 'shape',
          refId: 'a',
          dir: 'DOWN',
          buff: 0,
          alignedEdge: null,
          refSegmentIndex: null,
          selfSegmentIndex: null,
          bounds: null,
        },
        { kind: 'absolute' },
      ],
    );
    const p = resolvePosition(b, mapOf(a, b));
    expect(p.x).toBeCloseTo(2);
    expect(p.y).toBeCloseTo(-3);
  });
});

describe('resolvePosition to_edge text bounds', () => {
  it('keeps legacy text to_edge centered on tight ink dimensions', () => {
    const line = textLine([{ kind: 'to_edge', edge: 'RIGHT', buff: 0.3 }]);
    const p = resolvePosition(line, mapOf(line));
    expect(p.x).toBeCloseTo(FRAME_W / 2 - measuredLine.widthInk / 2 - 0.3);
  });

  it('uses mobject dimensions when to_edge bounds is mobject', () => {
    const line = textLine([{ kind: 'to_edge', edge: 'RIGHT', buff: 0.3, bounds: 'mobject' }]);
    const p = resolvePosition(line, mapOf(line));
    expect(p.x).toBeCloseTo(FRAME_W / 2 - measuredLine.width / 2 - 0.3);
  });

  it('aligns the measured visible ink edge when to_edge bounds is ink', () => {
    const line = textLine([{ kind: 'to_edge', edge: 'UP', buff: 0.5, bounds: 'ink' }]);
    const p = resolvePosition(line, mapOf(line));
    expect(p.y).toBeCloseTo(FRAME_H / 2 - 0.5 - measuredLine.inkTopY);
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

describe('getItemBBox polyline', () => {
  it('uses point extent width and height scaled by item.scale', () => {
    const pl: ShapeItem = {
      ...shape('p', 0, 0, 1, 1, [{ kind: 'absolute' }]),
      shapeType: 'polyline',
      points: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 2 },
      ],
      scale: 2,
    };
    const b = getItemBBox(pl);
    expect(b.w).toBeCloseTo(3 * 2);
    expect(b.h).toBeCloseTo(2 * 2);
  });

  it('uses nonzero fallback for empty points', () => {
    const pl: ShapeItem = {
      ...shape('p', 0, 0, 1, 1, [{ kind: 'absolute' }]),
      shapeType: 'polyline',
      points: [],
    };
    const b = getItemBBox(pl);
    expect(b.w).toBeCloseTo(0.5);
    expect(b.h).toBeCloseTo(0.5);
  });
});
