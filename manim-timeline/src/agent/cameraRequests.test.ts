import { describe, expect, it } from 'vitest';
import { resolveCameraRequest } from './cameraRequests';

const ctx = { currentTimeSec: 5, items: new Map(), frames: [{ id: 'f1', col: 0, row: 0 }], startFrameId: 'f1', activeFrameId: 'f1' };

describe('resolveCameraRequest', () => {
  it('resolves frame descriptors to ordinary camera clips without request-only fields', () => {
    const result = resolveCameraRequest({ id: 'cam1', label: 'Zoom out', startTime: 5, targetMode: 'frame', targetFrameId: 'f1' }, ctx);
    expect(result.error).toBeUndefined();
    expect(result.item).toMatchObject({ kind: 'camera_move', targetFrameId: 'f1', targetWidth: expect.any(Number), offsetX: 0, offsetY: 0 });
    expect(result.item).not.toHaveProperty('targetMode');
  });

  it('clarifies invalid or ambiguous descriptors rather than guessing geometry', () => {
    expect(resolveCameraRequest({ targetMode: 'object', targetId: 'unknown' }, ctx).error).toMatch(/existing scene item/);
    expect(resolveCameraRequest({ targetMode: 'region', region: { left: 0, right: 0, bottom: 0, top: 1 } }, ctx).error).toMatch(/positive width/);
  });
});
