import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAxes, defaultSceneDefaults } from '@/store/factories';
import { previewAxes, renderSceneMp4, type RenderProgress } from '@/services/measureClient';

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

describe('renderSceneMp4 progress', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('sends a job id and the scene length, and reports progress until the render returns', async () => {
    vi.useFakeTimers();
    let finish: (r: Response) => void = () => {};
    const calls: { url: string; body?: unknown }[] = [];
    let polls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (url.includes('/api/render/progress')) {
          polls += 1;
          const body = polls === 1
            ? { phase: 'building', percent: 10, text_built: 1, text_total: 2 }
            : { phase: 'rendering', percent: 50, scene_time: 3, duration: 6 };
          return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
        }
        return new Promise<Response>((resolve) => { finish = resolve; });
      }),
    );
    const seen: RenderProgress[] = [];
    const pending = renderSceneMp4('http://m/', 'code', 'l', 'S', null, {
      expectedDurationSec: 6,
      onProgress: (p) => seen.push(p),
      pollMs: 100,
    });
    await vi.advanceTimersByTimeAsync(250);
    finish(new Response(new Blob(['mp4']), { status: 200 }));
    await vi.advanceTimersByTimeAsync(200);
    const blob = await pending;
    expect(await blob.text()).toBe('mp4');
    const render = calls.find((c) => c.url === 'http://m/api/render')!;
    const body = render.body as { job_id: string; expected_duration: number };
    expect(body.expected_duration).toBe(6);
    expect(body.job_id).toMatch(/^render-[A-Za-z0-9_-]+$/);
    expect(calls.some((c) => c.url === `http://m/api/render/progress?job_id=${body.job_id}`)).toBe(true);
    expect(seen[0]).toMatchObject({ phase: 'building', percent: 10, textBuilt: 1, textTotal: 2 });
    expect(seen[1]).toMatchObject({ phase: 'rendering', percent: 50, sceneTime: 3, duration: 6 });
    const pollsAtEnd = polls;
    await vi.advanceTimersByTimeAsync(500);
    expect(polls).toBe(pollsAtEnd);
  });

  it('stops polling quietly when the server has no progress route', async () => {
    vi.useFakeTimers();
    let finish: (r: Response) => void = () => {};
    let polls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/render/progress')) {
          polls += 1;
          return Promise.resolve(new Response('Not Found', { status: 404 }));
        }
        return new Promise<Response>((resolve) => { finish = resolve; });
      }),
    );
    const seen: RenderProgress[] = [];
    const pending = renderSceneMp4('http://m', 'code', 'l', 'S', null, { onProgress: (p) => seen.push(p), pollMs: 100 });
    await vi.advanceTimersByTimeAsync(450);
    expect(polls).toBe(1);
    finish(new Response(new Blob(['mp4']), { status: 200 }));
    await pending;
    expect(seen).toEqual([]);
  });
});
