import { describe, expect, it } from 'vitest';
import { computeNextToMobCenter } from '@/lib/nextToGeometry';
import type { PosStepNextTo, ShapeItem } from '@/types/scene';

function shape(id: string, x: number, y: number, w: number, h: number): ShapeItem {
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
    posSteps: [{ kind: 'absolute' }],
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

const baseNext: PosStepNextTo = {
  kind: 'next_to',
  refKind: 'shape',
  refId: 'r',
  dir: 'DOWN',
  buff: 0,
  alignedEdge: null,
  refSegmentIndex: null,
  selfSegmentIndex: null,
  bounds: null,
};

describe('computeNextToMobCenter', () => {
  it('places self below ref with centered x (DOWN, default alignment)', () => {
    const ref = shape('r', 0, 0, 2, 2);
    const self = shape('s', 0, 0, 2, 2);
    const p = computeNextToMobCenter({
      selfMobX: 0,
      selfMobY: 0,
      selfItem: self,
      refMobX: 0,
      refMobY: 0,
      refItem: ref,
      step: baseNext,
    });
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(-2);
  });

  it('aligns right edges when alignedEdge is RIGHT and dir is DOWN', () => {
    const ref = shape('r', 0, 0, 4, 2);
    const self = shape('s', 0, 0, 2, 2);
    const p = computeNextToMobCenter({
      selfMobX: 0,
      selfMobY: 0,
      selfItem: self,
      refMobX: 0,
      refMobY: 0,
      refItem: ref,
      step: { ...baseNext, alignedEdge: 'RIGHT' },
    });
    // Right edges match: ref right=2, self width 2 => self.x=1
    expect(p.x).toBeCloseTo(1);
    expect(p.y).toBeCloseTo(-2);
  });

  it('respects buff along direction', () => {
    const ref = shape('r', 0, 0, 2, 2);
    const self = shape('s', 0, 0, 2, 2);
    const p = computeNextToMobCenter({
      selfMobX: 0,
      selfMobY: 0,
      selfItem: self,
      refMobX: 0,
      refMobY: 0,
      refItem: ref,
      step: { ...baseNext, buff: 0.5 },
    });
    expect(p.y).toBeCloseTo(-2.5);
  });
});
