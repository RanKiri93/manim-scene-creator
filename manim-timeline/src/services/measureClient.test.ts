import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAxes, defaultSceneDefaults } from '@/store/factories';
import { previewAxes } from '@/services/measureClient';

describe('previewAxes anchor contract', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('normalizes finite v1 graph anchors into raster bounds', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, png_base64: 'AA==', png_width: 20, png_height: 10, left: -2, right: 2, top: 1, bottom: -1, offset_ink_x: 0, offset_ink_y: 0, metadata_version: 1, origin_x: .2, origin_y: -.1, x_unit_x: 1, x_unit_y: 0, y_unit_x: 0, y_unit_y: 1, coord_left: -4.8, coord_right: 5.2, coord_top: 2.9, coord_bottom: -3.1 }), { status: 200 })));
    const result = await previewAxes('http://localhost:8766', createAxes(defaultSceneDefaults()));
    expect(result.bounds).toMatchObject({ metadataVersion: 1, originX: .2, originY: -.1, xUnitX: 1, yUnitY: 1, coordLeft: -4.8, coordRight: 5.2 });
    expect(result.error).toBeNull();
  });

  it('rejects old, incomplete, or nonfinite anchor metadata for vector fallback', async () => {
    for (const response of [
      { ok: true, png_base64: 'AA==', png_width: 20, png_height: 10, left: -2, right: 2, top: 1, bottom: -1, offset_ink_x: 0, offset_ink_y: 0 },
      { ok: true, png_base64: 'AA==', png_width: 20, png_height: 10, left: -2, right: 2, top: 1, bottom: -1, offset_ink_x: 0, offset_ink_y: 0, metadata_version: 1, origin_x: Number.NaN },
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response), { status: 200 })));
      const result = await previewAxes('http://localhost:8766', createAxes(defaultSceneDefaults()));
      expect(result.bounds).toBeNull();
      expect(result.error).toMatch(/metadata version 1/);
    }
  });
});
