import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import SparkMD5 from 'spark-md5';
import type { ProjectFile } from '@/types/scene';
import {
  parseMtprojFromUint8Array,
  packMtprojToBlob,
} from '@/lib/mtprojBundle';
import {
  MtprojUnpackError,
  MTPROJ_BUNDLE_FORMAT_VERSION,
} from '@/lib/mtprojErrors';

function md5Lower(data: Uint8Array): string {
  const c = new Uint8Array(data.byteLength);
  c.set(data);
  return SparkMD5.ArrayBuffer.hash(c.buffer, false) as string;
}

function minimalProject(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    version: 10,
    savedAt: '2020-01-01T00:00:00.000Z',
    defaults: {
      font: '',
      fontSize: 48,
      mathColor: '#ffffff',
      exportNamePrefix: '',
      sceneName: 'Scene1',
    },
    items: [],
    measureConfig: {
      url: 'http://127.0.0.1:8765',
      enabled: true,
      includePreview: false,
    },
    ...overrides,
  };
}

describe('parseMtprojFromUint8Array', () => {
  it('throws MtprojUnpackError when asset bytes do not match manifest MD5', () => {
    const good = new Uint8Array([1, 2, 3]);
    const bad = new Uint8Array([9, 9, 9]);
    const manifest = {
      bundleFormatVersion: MTPROJ_BUNDLE_FORMAT_VERSION,
      assets: { 'assets/audio/x.webm': md5Lower(good) },
    };
    const state = minimalProject({
      audioItems: [
        {
          id: 'a1',
          text: 'x',
          audioUrl: 'assets/audio/x.webm',
          startTime: 0,
          duration: 1,
        },
      ],
    });
    const zipped = zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'state.json': strToU8(JSON.stringify(state)),
      'assets/audio/x.webm': bad,
    });
    expect(() => parseMtprojFromUint8Array(zipped)).toThrow(MtprojUnpackError);
  });

  it('loads state and rewrites virtual audio paths to blob URLs', () => {
    const bytes = new Uint8Array([11, 22, 33]);
    const manifest = {
      bundleFormatVersion: MTPROJ_BUNDLE_FORMAT_VERSION,
      assets: { 'assets/audio/clip.webm': md5Lower(bytes) },
    };
    const state = minimalProject({
      audioItems: [
        {
          id: 't1',
          text: 'hello',
          audioUrl: 'assets/audio/clip.webm',
          startTime: 0,
          duration: 1.5,
        },
      ],
    });
    const zipped = zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'state.json': strToU8(JSON.stringify(state)),
      'assets/audio/clip.webm': bytes,
    });
    const origCreate = URL.createObjectURL.bind(URL);
    const origRevoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = () => 'blob:unit-test';
    URL.revokeObjectURL = () => {};
    try {
      const out = parseMtprojFromUint8Array(zipped);
      expect(out.audioItems).toHaveLength(1);
      expect(out.audioItems![0].audioUrl).toBe('blob:unit-test');
      expect(out.audioItems![0].assetRelPath).toBe('assets/audio/clip.webm');
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });
});

describe('packMtprojToBlob + parseMtprojFromUint8Array', () => {
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([7, 8, 9, 10]))) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('round-trips audio with virtual paths and checksums', async () => {
    const origCreate = URL.createObjectURL.bind(URL);
    const origRevoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = () => 'blob:roundtrip';
    URL.revokeObjectURL = () => {};
    try {
      const project = minimalProject({
        audioItems: [
          {
            id: 'trk',
            text: 'narration',
            audioUrl: 'https://example.com/assets/narration.webm',
            startTime: 0,
            duration: 3,
          },
        ],
      });
      const blob = await packMtprojToBlob(project);
      const out = parseMtprojFromUint8Array(new Uint8Array(await blob.arrayBuffer()));
      expect(out.audioItems![0].assetRelPath).toBe('assets/audio/narration.webm');
      expect(out.audioItems![0].audioUrl).toBe('blob:roundtrip');
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });
});
