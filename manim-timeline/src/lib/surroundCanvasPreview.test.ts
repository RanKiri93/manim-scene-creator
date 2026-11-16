import { describe, expect, it } from 'vitest';
import { createSurroundingRect, createTextLine, defaultSceneDefaults } from '@/store/factories';
import { surroundLabelLayout, textLineSurroundCenterAndHalfExtents } from '@/lib/surroundCanvasPreview';
import type { SurroundingRectItem } from '@/types/scene';

describe('scaled text ink surround bounds', () => {
  it('scales the measured Hebrew ink offset and half extents together', () => {
    const line = createTextLine(defaultSceneDefaults());
    line.scale = 2;
    line.measure = {
      width: 4, height: 1, widthInk: 2, heightInk: 0.5,
      offsetInkX: 0.5, offsetInkY: 0.1,
      inkLeftX: -0.5, inkRightX: 1.5, inkTopY: 0.35, inkBottomY: -0.15,
      bboxLeft: -2, bboxRight: 2, bboxTop: 0.5, bboxBottom: -0.5,
      pngBase64: null, pngWidth: null, pngHeight: null,
      segmentMeasures: null, mathChildMeasures: null,
    };
    expect(textLineSurroundCenterAndHalfExtents(line, { x: 3, y: 4 }, { w: 4, h: 1 })).toEqual({
      cx: 4, cy: 4.2, hw: 2, hh: 0.5,
    });
  });

  it('keeps the unit-scale center and half extents unchanged', () => {
    const line = createTextLine(defaultSceneDefaults());
    line.measure = {
      width: 4, height: 1, widthInk: 2, heightInk: 0.5,
      offsetInkX: 0.5, offsetInkY: 0.1,
      inkLeftX: -0.5, inkRightX: 1.5, inkTopY: 0.35, inkBottomY: -0.15,
      bboxLeft: -2, bboxRight: 2, bboxTop: 0.5, bboxBottom: -0.5,
      pngBase64: null, pngWidth: null, pngHeight: null,
      segmentMeasures: null, mathChildMeasures: null,
    };
    expect(textLineSurroundCenterAndHalfExtents(line, { x: 3, y: 4 }, { w: 2, h: 0.5 })).toEqual({
      cx: 3.5, cy: 4.1, hw: 1, hh: 0.25,
    });
  });
});

describe('surroundLabelLayout', () => {
  const box = { left: -1, right: 1, bottom: -0.5, top: 0.5 };
  const rect = (labelText: string, labelDir: SurroundingRectItem['labelDir']) =>
    ({ ...createSurroundingRect(['x'], 0), labelText, labelDir, labelFontSize: 48 }) as SurroundingRectItem;

  it('places the label next_to the rect with the export buffer, like Manim', () => {
    const up = surroundLabelLayout(rect('$\\alpha$ זווית', 'UP'), box)!;
    expect(up.text).toBe('αזווית'); // texPreviewText drops the space after a command, as for matrices
    expect(up.cx).toBeCloseTo(0);
    expect(up.cy - up.height / 2).toBeCloseTo(0.5 + 0.12);
    const dr = surroundLabelLayout(rect('a', 'DR'), box)!;
    expect(dr.cx - dr.width / 2).toBeCloseTo(1 + 0.12);
    expect(dr.cy + dr.height / 2).toBeCloseTo(-0.5 - 0.12);
  });

  it('has no label for empty text', () => {
    expect(surroundLabelLayout(rect('  ', 'UP'), box)).toBeNull();
  });
});
