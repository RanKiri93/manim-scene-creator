import { describe, expect, it } from 'vitest';
import { FRAME_W } from '@/lib/constants';
import { migrateItemsToV42 } from '@/lib/migrateProjectToV42';
import { createCameraMove, createTextLine, defaultSceneDefaults } from '@/store/factories';
import type { CameraMoveItem } from '@/types/scene';

describe('migrateItemsToV42', () => {
  it('adds full width to a legacy camera pan and preserves its authored data', () => {
    const authored = { ...createCameraMove('frame-1', 3, 2), id: 'cam', offsetX: 1.5, offsetY: -2 };
    const legacy = Object.fromEntries(
      Object.entries(authored).filter(([key]) => key !== 'targetWidth'),
    ) as unknown as CameraMoveItem;
    const out = migrateItemsToV42([legacy]);
    const camera = out[0] as CameraMoveItem;
    expect(camera.targetWidth).toBe(FRAME_W);
    expect(camera.targetFrameId).toBe('frame-1');
    expect(camera.startTime).toBe(3);
    expect(camera.duration).toBe(2);
    expect(camera.offsetX).toBe(1.5);
    expect(camera.offsetY).toBe(-2);
  });

  it('preserves an existing width including authored zoom widths', () => {
    const camera = createCameraMove('frame-1', 0, 1);
    camera.targetWidth = 4.25;
    const out = migrateItemsToV42([camera])[0] as CameraMoveItem;
    expect(out.targetWidth).toBe(4.25);
  });

  it('preserves unrelated item fields and returns fresh copies', () => {
    const line = createTextLine(defaultSceneDefaults(), 0);
    line.snapBuffer = 0.42;
    const camera = createCameraMove('frame-1', 0, 1);
    const input = [line, camera];
    const once = migrateItemsToV42(input);
    expect(once[0]).toEqual(line);
    expect(once[0]).not.toBe(line);
    expect(once[1]).not.toBe(camera);
    const twice = migrateItemsToV42(once);
    expect(twice).toEqual(once);
    expect(twice[0]).not.toBe(once[0]);
    expect(twice[1]).not.toBe(once[1]);
  });
});
