import { describe, expect, it } from 'vitest';
import { FRAME_W } from '@/lib/constants';
import {
  cameraEase,
  cameraPoseAtTime,
  fitCameraBounds,
  logicalCameraFrameAtTime,
  resolveCameraSchedule,
  validateCameraMove,
} from '@/lib/camera';
import { createCameraMove, createFrame } from '@/store/factories';
import type { CameraMoveItem } from '@/types/scene';

function cam(
  id: string,
  frameId: string,
  start: number,
  duration: number,
  width = FRAME_W,
  layer = 0,
): CameraMoveItem {
  const item = createCameraMove(frameId, start, duration);
  item.id = id;
  item.layer = layer;
  item.targetWidth = width;
  return item;
}

const home = createFrame(0, 0, 'Home');
const right = createFrame(1, 0, 'Right');
const frames = [home, right];

describe('camera pose at time', () => {
  it('eases before, through, and after a full-width pan', () => {
    const move = cam('a', right.id, 2, 2);
    const initial = cameraPoseAtTime(0, [move], frames, home.id);
    expect(initial.x).toBe(0);
    expect(initial.y).toBeCloseTo(0);
    expect(initial.width).toBe(FRAME_W);
    const quarter = cameraPoseAtTime(2.5, [move], frames, home.id);
    expect(quarter.x).toBeCloseTo(FRAME_W * cameraEase(0.25));
    expect(quarter.width).toBeCloseTo(FRAME_W);
    expect(cameraPoseAtTime(3, [move], frames, home.id).x).toBeCloseTo(FRAME_W / 2);
    expect(cameraPoseAtTime(4, [move], frames, home.id).x).toBeCloseTo(FRAME_W);
    expect(cameraPoseAtTime(8, [move], frames, home.id).x).toBeCloseTo(FRAME_W);
  });

  it('holds a zoom, returns to full frame, and is seek-independent', () => {
    const zoom = cam('zoom', right.id, 1, 1, 4);
    const returnMove = cam('return', right.id, 4, 1, FRAME_W);
    const items = [zoom, returnMove];
    expect(cameraPoseAtTime(3, items, frames, home.id).width).toBeCloseTo(4);
    expect(cameraPoseAtTime(4.5, items, frames, home.id).width).toBeGreaterThan(4);
    expect(cameraPoseAtTime(5, items, frames, home.id).width).toBeCloseTo(FRAME_W);
    const beforeReturn = cameraPoseAtTime(2, items, frames, home.id);
    cameraPoseAtTime(6, items, frames, home.id);
    expect(cameraPoseAtTime(2, items, frames, home.id)).toEqual(beforeReturn);
  });

  it('resolves a non-origin frame and tolerates legacy missing width', () => {
    const legacy = { ...cam('legacy', right.id, 0, 1), targetWidth: undefined } as unknown as CameraMoveItem;
    const pose = cameraPoseAtTime(1, [legacy], frames, home.id);
    expect(pose).toEqual({ x: FRAME_W, y: 0, width: FRAME_W });
  });
});

describe('camera region fit', () => {
  it('fits wide and tall regions with aspect-correct visible space', () => {
    const wide = fitCameraBounds({ left: -4, right: 4, bottom: -1, top: 1 });
    expect(wide.ok).toBe(true);
    if (!wide.ok) return;
    expect(wide.destination).toEqual({ x: 0, y: 0, width: 8 });
    expect(wide.viewport.top - wide.viewport.bottom).toBeCloseTo(8 * 8 / FRAME_W);

    const tall = fitCameraBounds({ left: -1, right: 1, bottom: -3, top: 3 });
    expect(tall.ok).toBe(true);
    if (!tall.ok) return;
    expect(tall.destination.width).toBeCloseTo(6 * FRAME_W / 8);
  });

  it('normalizes reversed drags and rejects zero or nonfinite regions', () => {
    const reversed = fitCameraBounds({ left: 3, right: -3, bottom: 2, top: -2 });
    expect(reversed.ok).toBe(true);
    if (reversed.ok) {
      expect(reversed.destination.x).toBe(0);
      expect(reversed.destination.y).toBe(0);
      expect(reversed.destination.width).toBeCloseTo(4 * FRAME_W / 8);
    }
    expect(fitCameraBounds({ left: 0, right: 0, bottom: -1, top: 1 }).ok).toBe(false);
    expect(fitCameraBounds({ left: NaN, right: 1, bottom: -1, top: 1 }).ok).toBe(false);
  });
});

describe('camera schedule validation', () => {
  it('accepts same-layer and cross-layer overlaps and touching endpoints', () => {
    const a = cam('a', right.id, 0, 2, 5, 0);
    const b = cam('b', home.id, 1, 2, 6, 3);
    const c = cam('c', right.id, 2, 1, 7, 2);
    expect(validateCameraMove(a, frames)).toEqual([]);
    expect(validateCameraMove(b, frames)).toEqual([]);
    expect(validateCameraMove(c, frames)).toEqual([]);
    expect(resolveCameraSchedule([a, b, c], frames, home.id).diagnostics).toEqual([]);
  });

  it('reports missing frames, invalid width, and invalid times', () => {
    const missing = cam('missing', 'gone', 0, 1);
    const width = cam('width', home.id, 0, 1, 0);
    const time = cam('time', home.id, -1, 1);
    expect(validateCameraMove(missing, frames)).toHaveLength(1);
    expect(validateCameraMove(width, frames)).toHaveLength(1);
    expect(validateCameraMove(time, frames)).toHaveLength(1);
  });
});

describe('camera later-start override', () => {
  it('interrupts A from its sampled original easing and never resumes it', () => {
    const a = cam('a', right.id, 0, 10, 4, 0);
    const b = cam('b', home.id, 2, 1, 8, 4);
    const schedule = resolveCameraSchedule([a, b], frames, home.id);
    const aSegment = schedule.segments.find((segment) => segment.clip.id === 'a')!;
    const bSegment = schedule.segments.find((segment) => segment.clip.id === 'b')!;
    expect(aSegment.effectiveEndTime).toBe(2);
    expect(aSegment.overriddenBy?.id).toBe('b');
    expect(aSegment.nominalEndTime).toBe(10);
    expect(bSegment.source).toEqual({
      x: FRAME_W * cameraEase(0.2),
      y: 0,
      width: FRAME_W + (4 - FRAME_W) * cameraEase(0.2),
    });
    expect(cameraPoseAtTime(2, [a, b], frames, home.id)).toEqual(bSegment.source);
    expect(cameraPoseAtTime(3, [a, b], frames, home.id)).toEqual({ x: 0, y: 0, width: 8 });
    expect(cameraPoseAtTime(9, [a, b], frames, home.id)).toEqual({ x: 0, y: 0, width: 8 });
    expect([a.startTime, a.duration]).toEqual([0, 10]);
  });

  it('chains three sampled interruptions', () => {
    const a = cam('a', right.id, 0, 10, 4);
    const b = cam('b', home.id, 2, 4, 8);
    const c = cam('c', right.id, 4, 1, 6);
    const schedule = resolveCameraSchedule([a, b, c], frames, home.id);
    expect(schedule.segments.find((s) => s.clip.id === 'a')?.effectiveEndTime).toBe(2);
    expect(schedule.segments.find((s) => s.clip.id === 'b')?.effectiveEndTime).toBe(4);
    expect(cameraPoseAtTime(5, [a, b, c], frames, home.id)).toEqual({ x: FRAME_W, y: 0, width: 6 });
    expect(cameraPoseAtTime(20, [a, b, c], frames, home.id).width).toBeCloseTo(6);
  });

  it('uses a completed full-frame pose as the next source', () => {
    const zoom = cam('zoom', right.id, 0, 1, 4);
    const completedReturn = cam('return', right.id, 3, 1, FRAME_W);
    const zoomAgain = cam('again', home.id, 5, 1, 7);
    const b = resolveCameraSchedule([zoom, completedReturn, zoomAgain], frames, home.id).segments[2]!;
    expect(b.source).toEqual({ x: FRAME_W, y: 0, width: FRAME_W });
  });

  it('interrupts a moving return continuously', () => {
    const zoom = cam('zoom', right.id, 0, 1, 4);
    const movingReturn = cam('return', right.id, 2, 3, FRAME_W);
    const later = cam('later', home.id, 3, 1, 6);
    const source = resolveCameraSchedule([zoom, movingReturn, later], frames, home.id).segments[2]!.source;
    expect(source.width).toBeGreaterThan(4);
    expect(source.width).toBeLessThan(FRAME_W);
  });

  it('uses the last id for exact equal starts without collapsing nearby starts', () => {
    const a = cam('a', right.id, 0, 1, 4);
    const b = cam('b', home.id, 0, 1, 8);
    const near = cam('near', right.id, 0.0001, 1, 6);
    const schedule = resolveCameraSchedule([b, a, near], frames, home.id);
    expect(schedule.segments.find((s) => s.clip.id === 'a')?.supersededByEqualStart?.id).toBe('b');
    expect(schedule.segments.find((s) => s.clip.id === 'near')?.supersededByEqualStart).toBeNull();
    expect(cameraPoseAtTime(1, [b, a, near], frames, home.id).width).toBeCloseTo(6);
  });

  it('keeps a scheduled return independent after an intervening zoom', () => {
    const a = cam('a', right.id, 5, 1, 4);
    const b = cam('b', right.id, 7, 1, 8);
    const returnMove = cam('return', right.id, 9, 1, FRAME_W);
    const schedule = resolveCameraSchedule([a, b, returnMove], frames, home.id);
    const ret = schedule.segments.find((s) => s.clip.id === 'return')!;
    expect(ret.startTime).toBe(9);
    expect(ret.nominalEndTime).toBe(10);
    expect(ret.destination.width).toBe(FRAME_W);
    expect(ret.source).toEqual({ x: FRAME_W, y: 0, width: 8 });
    expect(cameraPoseAtTime(10.5, [a, b, returnMove], frames, home.id).width).toBeCloseTo(FRAME_W);
  });

  it('lets a return interrupt a longer zoom and prevents that zoom from resuming', () => {
    const b = cam('b', right.id, 7, 4, 8);
    const returnMove = cam('return', right.id, 9, 1, FRAME_W);
    const items = [b, returnMove];
    expect(cameraPoseAtTime(9, items, frames, home.id).width).toBeLessThan(FRAME_W);
    expect(cameraPoseAtTime(9, items, frames, home.id).width).toBeGreaterThan(8);
    expect(cameraPoseAtTime(10, items, frames, home.id).width).toBeCloseTo(FRAME_W);
    expect(cameraPoseAtTime(11, items, frames, home.id).width).toBeCloseTo(FRAME_W);
  });

  it('never adopts an interrupted destination at its nominal end', () => {
    const a = cam('a', right.id, 0, 10, 4);
    const b = cam('b', home.id, 2, 1, 8);
    const schedule = resolveCameraSchedule([a, b], frames, home.id);
    expect(logicalCameraFrameAtTime(2.5, schedule)).toBe(home.id);
    expect(logicalCameraFrameAtTime(9.9, schedule)).toBe(home.id);
    expect(logicalCameraFrameAtTime(12, schedule)).toBe(home.id);
  });
});
