import { describe, expect, it } from 'vitest';
import {
  anchoredScalePoint,
  cameraViewportTransform,
  canvasToWorldPoint,
  manimToCanvas,
  worldToCanvasPoint,
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

describe('camera viewport coordinates', () => {
  it.each([
    { width: 14.222222222222221, x: 0, y: 0 },
    { width: 7.111111111111111, x: 14.222222222222221, y: -8 },
    { width: 28.444444444444443, x: -14.222222222222221, y: 16 },
  ])('round-trips world to screen to world at camera width $width', (pose) => {
    const transform = cameraViewportTransform(pose, 960, 540);
    const world = { x: pose.x + 2.25, y: pose.y - 1.5 };
    const canvas = worldToCanvasPoint(world, 960, 540, transform);
    const back = canvasToWorldPoint(canvas, 960, 540, transform);
    expect(back.x).toBeCloseTo(world.x);
    expect(back.y).toBeCloseTo(world.y);
  });

  it('composes a panned camera across non-origin frame rows and columns', () => {
    const pose = { x: 14.222222222222221, y: -8, width: 9 };
    const transform = cameraViewportTransform(pose, 1200, 675);
    const canvas = worldToCanvasPoint({ x: 20, y: -10 }, 1200, 675, transform);
    expect(canvasToWorldPoint(canvas, 1200, 675, transform)).toEqual({ x: 20, y: -10 });
  });

  it('round-trips through a resized letterboxed stage', () => {
    const pose = { x: 3, y: -2, width: 6 };
    const transform = cameraViewportTransform(pose, 641, 361);
    const world = { x: -4, y: 2.5 };
    const canvas = worldToCanvasPoint(world, 641, 361, transform);
    const back = canvasToWorldPoint(canvas, 641, 361, transform);
    expect(back.x).toBeCloseTo(world.x);
    expect(back.y).toBeCloseTo(world.y);
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
