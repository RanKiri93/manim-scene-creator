import { describe, expect, it } from 'vitest';
import {
  anchoredScalePoint,
  manimToCanvas,
  surroundBBoxCanvasCenter,
} from './canvasManimCoords';

describe('manimToCanvas', () => {
  it('maps origin to canvas center for square frame mapping', () => {
    const { x, y } = manimToCanvas(0, 0, 800, 450);
    expect(x).toBeCloseTo(400);
    expect(y).toBeCloseTo(225);
  });
});

describe('surroundBBoxCanvasCenter', () => {
  it('returns the rectangle center in canvas space', () => {
    const c = surroundBBoxCanvasCenter(
      { left: -2, right: 2, bottom: -1, top: 1 },
      800,
      450,
    );
    const cMidX = (manimToCanvas(-2, 0, 800, 450).x + manimToCanvas(2, 0, 800, 450).x) / 2;
    const cMidY = (manimToCanvas(0, 1, 800, 450).y + manimToCanvas(0, -1, 800, 450).y) / 2;
    expect(c.x).toBeCloseTo(cMidX);
    expect(c.y).toBeCloseTo(cMidY);
  });
});

describe('anchoredScalePoint', () => {
  it('leaves the pivot fixed and scales offset from pivot', () => {
    const p = anchoredScalePoint(300, 200, 400, 225, 1.5);
    expect(anchoredScalePoint(400, 225, 400, 225, 1.5)).toEqual({ x: 400, y: 225 });
    expect(p.x).toBeCloseTo(400 + 1.5 * (300 - 400));
    expect(p.y).toBeCloseTo(225 + 1.5 * (200 - 225));
  });
});
