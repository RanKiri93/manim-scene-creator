import { describe, expect, it } from 'vitest';
import { FRAME_H, FRAME_W } from './constants';
import { createAxes, createGraphDotItem, createGraphPlot, defaultSceneDefaults } from '@/store/factories';
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
  it('inserts graph axes and overlays at zero scene position', () => {
    const axes = createAxes(defaultSceneDefaults());
    const plot = createGraphPlot(axes.id);
    const dot = createGraphDotItem(axes.id);

    expect([axes.x, axes.y, plot.x, plot.y, dot.x, dot.y]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('keeps the centered canvas origin at the visible canvas center for the identity camera', () => {
    const transform = cameraViewportTransform(
      { x: 0, y: 0, width: 14.222222222222221 },
      960,
      540,
    );

    expect(transform).toEqual({ x: 0, y: 0, scale: 1 });
    expect(worldToCanvasPoint({ x: 0, y: 0 }, 960, 540, transform)).toEqual({
      x: 480,
      y: 270,
    });
  });

  it('places the camera center at canvas center for pan and zoom without sharing the round-trip formula', () => {
    const canvasWidth = 1200;
    const canvasHeight = 675;
    const pose = { x: 4, y: -3, width: FRAME_W / 2 };
    const transform = cameraViewportTransform(pose, canvasWidth, canvasHeight);
    const scale = FRAME_W / pose.width;

    expect(transform.scale).toBeCloseTo(scale);
    expect(worldToCanvasPoint(pose, canvasWidth, canvasHeight, transform)).toEqual({
      x: canvasWidth / 2,
      y: canvasHeight / 2,
    });
    const offsetWorld = { x: pose.x + 1, y: pose.y + 2 };
    const projected = worldToCanvasPoint(offsetWorld, canvasWidth, canvasHeight, transform);
    expect(projected.x).toBeCloseTo(canvasWidth / 2 + scale * canvasWidth / FRAME_W);
    expect(projected.y).toBeCloseTo(canvasHeight / 2 - scale * canvasHeight * 2 / FRAME_H);
  });

  it('round-trips a parent-local dragged graph position through store coordinates and playback', () => {
    const canvasWidth = 960;
    const canvasHeight = 540;
    const frameOffset = { x: 14.222222222222221, y: -8 };
    const pose = { x: frameOffset.x, y: frameOffset.y, width: 7.111111111111111 };
    const transform = cameraViewportTransform(pose, canvasWidth, canvasHeight);
    const desiredStoredPosition = { x: 2.5, y: -1.25 };
    const desiredWorldPosition = {
      x: desiredStoredPosition.x + frameOffset.x,
      y: desiredStoredPosition.y + frameOffset.y,
    };

    // Konva child x/y are local to the camera-transformed parent. Drag stores
    // that local centered-canvas position, excluding the item's frame offset.
    const parentLocal = manimToCanvas(desiredWorldPosition.x, desiredWorldPosition.y, canvasWidth, canvasHeight);
    const storedWorld = canvasToWorldPoint(
      worldToCanvasPoint(desiredWorldPosition, canvasWidth, canvasHeight, transform),
      canvasWidth,
      canvasHeight,
      transform,
    );
    const storedPosition = {
      x: storedWorld.x - frameOffset.x,
      y: storedWorld.y - frameOffset.y,
    };
    const playbackWorld = {
      x: storedPosition.x + frameOffset.x,
      y: storedPosition.y + frameOffset.y,
    };

    expect(parentLocal.x).toBeGreaterThan(0);
    expect(parentLocal.y).toBeGreaterThan(0);
    expect(storedPosition.x).toBeCloseTo(desiredStoredPosition.x);
    expect(storedPosition.y).toBeCloseTo(desiredStoredPosition.y);
    expect(playbackWorld.x).toBeCloseTo(desiredWorldPosition.x);
    expect(playbackWorld.y).toBeCloseTo(desiredWorldPosition.y);
    expect(worldToCanvasPoint(playbackWorld, canvasWidth, canvasHeight, cameraViewportTransform(
      { x: 0, y: 0, width: 14.222222222222221 }, canvasWidth, canvasHeight,
    ))).toEqual(manimToCanvas(playbackWorld.x, playbackWorld.y, canvasWidth, canvasHeight));
  });

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
