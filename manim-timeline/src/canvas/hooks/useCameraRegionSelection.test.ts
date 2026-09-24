import { describe, expect, it } from 'vitest';
import {
  cameraCaptureContextUnchanged,
  cameraRegionBoundsFromDrag,
} from './useCameraRegionSelection';

describe('camera region selection', () => {
  it('normalizes every drag direction into the same world bounds', () => {
    const downRight = cameraRegionBoundsFromDrag({ x: -2, y: -1 }, { x: 2, y: 1 });
    const upLeft = cameraRegionBoundsFromDrag({ x: 2, y: 1 }, { x: -2, y: -1 });
    expect(downRight.ok).toBe(true);
    expect(upLeft.ok).toBe(true);
    if (downRight.ok && upLeft.ok) expect(downRight.destination).toEqual(upLeft.destination);
  });

  it('rejects a no-op click and invalid near-zero region', () => {
    expect(cameraRegionBoundsFromDrag({ x: 1, y: 1 }, { x: 1, y: 1 }).ok).toBe(false);
    expect(cameraRegionBoundsFromDrag({ x: 0, y: 0 }, { x: 0.000001, y: 1 }).ok).toBe(false);
  });

  it('cancels when time, frames, start frame, or scene changes', () => {
    const frozen = { time: 5, frameIds: 'a|b', startFrameId: 'a', sceneId: 'scene-1' };
    expect(cameraCaptureContextUnchanged(frozen, { ...frozen })).toBe(true);
    expect(cameraCaptureContextUnchanged(frozen, { ...frozen, time: 6 })).toBe(false);
    expect(cameraCaptureContextUnchanged(frozen, { ...frozen, frameIds: 'a|c' })).toBe(false);
    expect(cameraCaptureContextUnchanged(frozen, { ...frozen, startFrameId: 'b' })).toBe(false);
    expect(cameraCaptureContextUnchanged(frozen, { ...frozen, sceneId: 'scene-2' })).toBe(false);
  });
});
