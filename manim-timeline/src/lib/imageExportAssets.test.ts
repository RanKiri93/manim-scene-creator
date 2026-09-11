import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageItem, SceneItem, ShapeItem } from '@/types/scene';
import {
  clearImageExportAssetCacheForTests,
  imageNeedsExportPreparation,
  prepareImageItemsForManimExport,
} from './imageExportAssets';

function image(over: Partial<ImageItem> = {}): ImageItem {
  return {
    id: 'img1',
    kind: 'image',
    label: '',
    layer: 0,
    startTime: 0,
    duration: 2,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    audioTrackId: null,
    srcUrl: 'blob:live-image',
    fileName: 'pic.png',
    mimeType: 'image/png',
    width: 2,
    height: 1,
    opacity: 1,
    rotationDeg: 0,
    ...over,
  };
}

function shape(): ShapeItem {
  return {
    id: 'sh1',
    kind: 'shape',
    label: '',
    layer: 0,
    startTime: 0,
    duration: 1,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    audioTrackId: null,
    shapeType: 'circle',
    rotationDeg: 0,
    radius: 0.5,
    width: 2,
    height: 1,
    endX: 2,
    endY: 0,
    points: [],
    tailArrow: false,
    headArrow: false,
    strokeColor: '#ffffff',
    strokeWidth: 2,
    fillColor: null,
    fillOpacity: 0,
    introStyle: 'create',
  };
}

const BYTES = new Uint8Array([1, 2, 3, 4]);
const BYTES_B64 = 'AQIDBA==';

function mockFetch(
  bytes: Uint8Array = BYTES,
  contentType: string | null = 'image/png',
  status = 200,
) {
  const headers = new Headers();
  if (contentType) headers.set('content-type', contentType);
  return vi.fn(async () =>
    new Response(bytes.slice().buffer, { status, headers }),
  );
}

beforeEach(() => {
  clearImageExportAssetCacheForTests();
  vi.unstubAllGlobals();
});

describe('imageNeedsExportPreparation', () => {
  it('flags live blob:/http(s): images without a bundle path', () => {
    expect(imageNeedsExportPreparation(image())).toBe(true);
    expect(
      imageNeedsExportPreparation(image({ srcUrl: 'https://x/y.jpg' })),
    ).toBe(true);
  });

  it('skips bundled, data:, and non-image items', () => {
    expect(
      imageNeedsExportPreparation(image({ assetRelPath: 'assets/textures/a.png' })),
    ).toBe(false);
    expect(
      imageNeedsExportPreparation(image({ srcUrl: 'assets/textures/a.png' })),
    ).toBe(false);
    expect(
      imageNeedsExportPreparation(image({ srcUrl: 'data:image/png;base64,AAA' })),
    ).toBe(false);
    expect(imageNeedsExportPreparation(shape())).toBe(false);
  });
});

describe('prepareImageItemsForManimExport', () => {
  it('converts a live blob URL into an export-only data: clone', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    const input = Object.freeze([image()]);

    const out = await prepareImageItemsForManimExport(input);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(1);
    expect(out[0]).not.toBe(input[0]);
    expect(out[0]).toMatchObject({
      kind: 'image',
      srcUrl: `data:image/png;base64,${BYTES_B64}`,
      fileName: 'pic.png',
    });
    // Store/persisted input untouched (frozen input proves no mutation).
    expect(input[0]!.srcUrl).toBe('blob:live-image');
    expect(input[0]!.assetRelPath).toBeUndefined();
  });

  it('prefers the response content-type, then the file extension', async () => {
    vi.stubGlobal('fetch', mockFetch(BYTES, 'image/jpeg'));
    const out = await prepareImageItemsForManimExport([
      image({ mimeType: '', fileName: 'photo.png' }),
    ]);
    expect(out[0]).toMatchObject({
      srcUrl: `data:image/jpeg;base64,${BYTES_B64}`,
    });

    clearImageExportAssetCacheForTests();
    vi.stubGlobal('fetch', mockFetch(BYTES, null));
    const out2 = await prepareImageItemsForManimExport([
      image({ mimeType: '', fileName: 'anim.gif', srcUrl: 'blob:other' }),
    ]);
    expect(out2[0]).toMatchObject({
      srcUrl: `data:image/gif;base64,${BYTES_B64}`,
    });
  });

  it('returns the input array as-is when nothing needs conversion', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    const items: SceneItem[] = [
      shape(),
      image({ assetRelPath: 'assets/textures/a.png' }),
      image({ id: 'img2', srcUrl: 'data:image/png;base64,AAA' }),
    ];

    const out = await prepareImageItemsForManimExport(items);

    expect(out).toBe(items);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches conversions per source URL', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    const a = image({ id: 'a' });
    const b = image({ id: 'b' });

    await prepareImageItemsForManimExport([a, b]);
    await prepareImageItemsForManimExport([a]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects with a clear error when fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    await expect(
      prepareImageItemsForManimExport([image({ fileName: 'gone.png' })]),
    ).rejects.toThrow(/gone\.png.*could not be read for Manim export/);
  });

  it('rejects with a clear error on HTTP failures', async () => {
    vi.stubGlobal('fetch', mockFetch(BYTES, 'image/png', 404));

    await expect(prepareImageItemsForManimExport([image()])).rejects.toThrow(
      /could not be read for Manim export \(HTTP 404\)/,
    );
  });

  it('rejects unsupported image types instead of mislabeling them', async () => {
    vi.stubGlobal('fetch', mockFetch(BYTES, 'image/webp'));

    await expect(
      prepareImageItemsForManimExport([
        image({ mimeType: 'image/webp', fileName: 'pic.webp' }),
      ]),
    ).rejects.toThrow(/unsupported image type.*PNG, JPG, or GIF/);
  });

  it('rejects empty and oversized images', async () => {
    vi.stubGlobal('fetch', mockFetch(new Uint8Array(0)));
    await expect(prepareImageItemsForManimExport([image()])).rejects.toThrow(
      /is empty/,
    );

    clearImageExportAssetCacheForTests();
    vi.stubGlobal(
      'fetch',
      mockFetch(new Uint8Array(8 * 1024 * 1024 + 1)),
    );
    await expect(
      prepareImageItemsForManimExport([image({ srcUrl: 'blob:big' })]),
    ).rejects.toThrow(/up to 8 MB.*smaller image file/);
  });
});
