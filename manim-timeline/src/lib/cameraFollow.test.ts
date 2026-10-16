import { describe, expect, it } from 'vitest';
import { createAxes, createCameraMove, createGraphDotItem, createGraphPlot, createTargetAnimation, defaultSceneDefaults } from '@/store/factories';
import type { FrameDef, ItemId, SceneItem } from '@/types/scene';
import { CAMERA_FOLLOW_BLEND, cameraPoseAtTime, resolveCameraSchedule } from './camera';
import { axesGraphToWorld } from './shapeAnchors';

const frames: FrameDef[] = [{ id: 'home', col: 0, row: 0 }];

/** Wide axes; dot on y = 0.1x moving x = 0 → 20 over 2..6 s; camera follows it 2..6 s at width 5. */
function scene() {
  const axes = createAxes(defaultSceneDefaults());
  axes.id = 'ax';
  axes.xRange = [0, 20, 5];
  axes.yRange = [0, 2, 1];
  axes.scaleX = 0.6;
  axes.scaleY = 1;
  const plot = createGraphPlot(axes.id);
  plot.id = 'p';
  plot.fn = { ...plot.fn, jsExpr: '0.1*x', pyExpr: '0.1*x' };
  plot.xDomain = [0, 20];
  const dot = createGraphDotItem(axes.id, 1);
  dot.id = 'd';
  dot.dot.attachment = { kind: 'function', graphPlotId: 'p', x: 0 };
  const move = createTargetAnimation('graphFollow', ['d'], 2, 4);
  move.id = 'm';
  move.targets[0] = { targetId: 'd', targetX: 20, easing: 'linear' };
  const cam = createCameraMove('home', 2, 4);
  cam.id = 'c';
  cam.targetWidth = 5;
  cam.follow = { targetId: 'd' };
  const items = new Map<ItemId, SceneItem>([axes, plot, dot, move, cam].map((it) => [it.id, it]));
  const world = (t: number, gx: number) => axesGraphToWorld(axes, gx, 0.1 * gx, { items, time: t, frames, startFrameId: 'home' });
  return { items, cam, world };
}

describe('camera follow', () => {
  it('eases onto the dot, then keeps it centred, and ends where the dot stops', () => {
    const { items, world } = scene();
    const pose = (t: number) => cameraPoseAtTime(t, items, frames, 'home');
    expect(pose(1).x + 0).toBe(0);
    expect(pose(1).y + 0).toBe(0);
    expect(pose(1).width).toBeCloseTo(14.2222, 3);
    const mid = pose(4); // x = 10
    expect(mid.x).toBeCloseTo(world(4, 10).x, 9);
    expect(mid.y).toBeCloseTo(world(4, 10).y, 9);
    expect(mid.width).toBe(5);
    // Halfway through the blend: between the start pose and the dot.
    const blendMid = pose(2 + CAMERA_FOLLOW_BLEND / 2);
    const d = world(2 + CAMERA_FOLLOW_BLEND / 2, 20 * (CAMERA_FOLLOW_BLEND / 2) / 4);
    expect(blendMid.x).toBeCloseTo(d.x / 2, 6);
    expect(pose(9).x).toBeCloseTo(world(6, 20).x, 9);
    const seg = resolveCameraSchedule(items, frames, 'home').segments[0]!;
    expect(seg.follow?.blend).toBe(CAMERA_FOLLOW_BLEND);
    expect(seg.destination.x).toBeCloseTo(world(6, 20).x, 9);
  });

  it('reports a target it cannot follow or one that appears later', () => {
    const { items, cam } = scene();
    items.set('c', { ...cam, follow: { targetId: 'm' } });
    expect(resolveCameraSchedule(items, frames, 'home').diagnostics[0]?.message).toMatch(/can follow a graph dot, text line, shape, image or axes, not a target_animation/);
    items.set('c', { ...cam, startTime: 0.5 });
    expect(resolveCameraSchedule(items, frames, 'home').diagnostics[0]?.message).toMatch(/starts at 0.50s, before "d" appears \(1.00s\)/);
  });
});
