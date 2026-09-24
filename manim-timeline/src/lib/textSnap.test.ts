import { describe, expect, it } from 'vitest';
import { FRAME_H, FRAME_W } from '@/lib/constants';
import { measuredInkBox, snapTextPosition, type SnapBox } from '@/lib/textSnap';
import type { MeasureResult } from '@/types/scene';

const measure = {
  width: 4, height: 1, widthInk: 2, heightInk: 0.5,
  offsetInkX: 0.5, offsetInkY: 0.1,
  inkLeftX: -0.5, inkRightX: 1.5, inkBottomY: -0.15, inkTopY: 0.35,
  bboxLeft: -2, bboxRight: 2, bboxTop: 0.5, bboxBottom: -0.5,
  pngBase64: null, pngWidth: null, pngHeight: null,
  segmentMeasures: null, mathChildMeasures: null,
} satisfies MeasureResult;

describe('text snap bounds', () => {
  it('scales measured Hebrew ink edges with the mobject anchor', () => {
    expect(measuredInkBox('line', 1, 2, measure, 2)).toEqual({
      id: 'line', left: 0, right: 4, bottom: 1.7, top: 2.7,
    });
  });

  it('rejects missing or invalid measured bounds', () => {
    expect(measuredInkBox('line', 0, 0, null, 1)).toBeNull();
    expect(measuredInkBox('line', 0, 0, { ...measure, inkLeftX: NaN }, 1)).toBeNull();
  });
});

describe('text snap solver', () => {
  const noTargets: SnapBox[] = [];

  it('uses the configurable equal inset buffer on every frame edge', () => {
    const buffer = 0.3;
    const expectedLeftAnchor = -FRAME_W / 2 + buffer - (-0.5);
    const result = snapTextPosition({
      x: expectedLeftAnchor + 0.05, y: 0,
      ink: { left: -0.5, right: 1.5, bottom: -0.15, top: 0.35 },
      targets: noTargets, frameCenter: { x: 0, y: 0 }, buffer,
      pxPerUnitX: 80, pxPerUnitY: 80,
    });
    expect(result.x).toBeCloseTo(expectedLeftAnchor);
    expect(result.guides[0]?.targetId).toBe('frame-left');
    expect(FRAME_H).toBe(8);
  });

  it('places measured text 0.3 units below a nearby box', () => {
    const result = snapTextPosition({
      x: 0, y: 0.3,
      ink: { left: -0.5, right: 1.5, bottom: -0.15, top: 0.35 },
      targets: [{ id: 'other', left: -1, right: 2, bottom: 1, top: 2 }],
      frameCenter: { x: 0, y: 0 }, buffer: 0.3,
      pxPerUnitX: 100, pxPerUnitY: 100,
    });
    // target bottom is y=1; moving ink top becomes y=0.7.
    expect(result.y).toBeCloseTo(0.35);
    expect(result.guides.some((g) => g.axis === 'y')).toBe(true);
  });

  it('does not attract from beyond the pixel threshold', () => {
    const result = snapTextPosition({
      x: 0, y: 0,
      ink: { left: -0.5, right: 1.5, bottom: -0.15, top: 0.35 },
      targets: [{ id: 'far', left: 4, right: 5, bottom: -1, top: 1 }],
      frameCenter: { x: 0, y: 0 },
      pxPerUnitX: 100, pxPerUnitY: 100,
    });
    expect(result.x).toBe(0);
    expect(result.guides.some((g) => g.targetId.startsWith('far'))).toBe(false);
  });

  it('uses a manually selected buffer value for the placement', () => {
    const result = snapTextPosition({
      x: 0, y: 0.03,
      ink: { left: -0.5, right: 1.5, bottom: -0.15, top: 0.35 },
      targets: [{ id: 'other', left: -1, right: 2, bottom: 1, top: 2 }],
      frameCenter: { x: 0, y: 0 }, buffer: 0.6,
      pxPerUnitX: 100, pxPerUnitY: 100,
    });
    expect(result.y).toBeCloseTo(0.05);
    expect(result.guides[0]?.label).toBe('0.6');
  });
});
