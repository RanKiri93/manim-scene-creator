import { describe, expect, it } from 'vitest';
import {
  createImageItem,
  createTextLine,
  defaultSceneDefaults,
} from '@/store/factories';
import { migrateItemsToV41 } from '@/lib/migrateProjectToV41';

describe('migrateItemsToV41', () => {
  it('passes v40 items through with fresh copies', () => {
    const line = createTextLine(defaultSceneDefaults(), 0);
    line.id = 'l1';
    const out = migrateItemsToV41([line]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(line);
    expect(out[0]).not.toBe(line);
  });

  it('is idempotent for image items', () => {
    const img = createImageItem({
      srcUrl: 'blob:test',
      fileName: 'pic.png',
      mimeType: 'image/png',
      width: 3,
      height: 2,
      startTime: 1,
    });
    img.id = 'img1';
    const once = migrateItemsToV41([img]);
    const twice = migrateItemsToV41(once);
    expect(twice[0]).toEqual(once[0]);
    expect(twice[0]).not.toBe(once[0]);
    if (twice[0]?.kind !== 'image') throw new Error('expected image');
    expect(twice[0].srcUrl).toBe('blob:test');
  });
});
