import { describe, expect, it } from 'vitest';
import { FRAME_W } from '@/lib/constants';
import { cameraViewportTransform } from '@/lib/canvasManimCoords';
import { cameraCropRect } from './agentSnapshot';

describe('camera crop for Copilot snapshots', () => {
  it('is the whole stage for the home camera under the follow transform', () => {
    const pose = { x: 0, y: 0, width: FRAME_W };
    const rect = cameraCropRect(pose, 1600, 900, cameraViewportTransform(pose, 1600, 900));
    expect(rect.x).toBeCloseTo(0);
    expect(rect.y).toBeCloseTo(0);
    expect(rect.width).toBeCloseTo(1600);
    expect(rect.height).toBeCloseTo(900);
  });

  it('crops a zoomed camera out of an unzoomed view', () => {
    const view = cameraViewportTransform({ x: 0, y: 0, width: FRAME_W }, 1600, 900);
    const rect = cameraCropRect({ x: FRAME_W / 4, y: 0, width: FRAME_W / 2 }, 1600, 900, view);
    expect(rect.x).toBeCloseTo(800);
    expect(rect.y).toBeCloseTo(225);
    expect(rect.width).toBeCloseTo(800);
    expect(rect.height).toBeCloseTo(450);
  });
});
