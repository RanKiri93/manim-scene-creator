import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import SparkMD5 from 'spark-md5';
import type { AudioTrackItem, MultiSceneProjectFile, ProjectFile, ProjectFragmentFile } from '@/types/scene';
import { isMultiSceneProjectFile, MULTISCENE_PROJECT_KIND } from '@/types/scene';
import { defaultFrames } from '@/store/factories';
import {
  parseMtprojFromUint8Array,
  packMtprojToBlob,
} from '@/lib/mtprojBundle';
import {
  MtprojUnpackError,
  MTPROJ_BUNDLE_FORMAT_VERSION,
} from '@/lib/mtprojErrors';

/** Audio items for asserting legacy-first-scene semantics when tests pack `ProjectFile` only. */
function audioFromParsedProject(
  out: ProjectFile | MultiSceneProjectFile | ProjectFragmentFile,
): AudioTrackItem[] {
  if (isMultiSceneProjectFile(out)) {
    return out.scenes[0]?.audioItems ?? [];
  }
  return out.audioItems ?? [];
}

function md5Lower(data: Uint8Array): string {
  const c = new Uint8Array(data.byteLength);
  c.set(data);
  return SparkMD5.ArrayBuffer.hash(c.buffer, false) as string;
}

function minimalProject(overrides: Partial<ProjectFile> = {}): ProjectFile {
  const frameConfig = defaultFrames();
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
    frames: frameConfig.frames,
    startFrameId: frameConfig.startFrameId,
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
      const aud = audioFromParsedProject(out);
      expect(aud).toHaveLength(1);
      expect(aud[0].audioUrl).toBe('blob:unit-test');
      expect(aud[0].assetRelPath).toBe('assets/audio/clip.webm');
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
      const aud = audioFromParsedProject(out);
      expect(aud[0].assetRelPath).toBe('assets/audio/narration.webm');
      expect(aud[0].audioUrl).toBe('blob:roundtrip');
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });

  it('round-trips optional audioProcessing metadata on tracks', async () => {
    const origCreate = URL.createObjectURL.bind(URL);
    const origRevoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = () => 'blob:roundtrip-meta';
    URL.revokeObjectURL = () => {};
    try {
      const project = minimalProject({
        audioItems: [
          {
            id: 'trk',
            text: 'x',
            audioUrl: 'http://127.0.0.1:8765/assets/audio/a.webm',
            startTime: 0,
            duration: 2,
            audioProcessing: {
              normalized: {
                targetLufs: -16,
                processedAt: '2026-05-14T12:00:00.000Z',
                sourceAssetRelPath: 'assets/audio/old.webm',
              },
            },
          },
        ],
      });
      const blob = await packMtprojToBlob(project);
      const out = parseMtprojFromUint8Array(new Uint8Array(await blob.arrayBuffer()));
      const aud = audioFromParsedProject(out);
      expect(aud[0].audioProcessing?.normalized?.targetLufs).toBe(-16);
      expect(aud[0].audioProcessing?.normalized?.sourceAssetRelPath).toBe(
        'assets/audio/old.webm',
      );
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });
});

describe('packMtprojToBlob multi-scene', () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('collects audio from every scene and rehydrates independently', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const u =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (u.includes('scene-a'))
        return new Response(new Uint8Array([99, 1]));
      if (u.includes('scene-b'))
        return new Response(new Uint8Array([98, 2, 2]));
      throw new Error(`unexpected fetch: ${u}`);
    }) as typeof fetch;

    let seq = 0;
    const origCreate = URL.createObjectURL.bind(URL);
    const origRevoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = () => {
      seq += 1;
      return `blob:ms-${seq}`;
    };
    URL.revokeObjectURL = () => {};

    try {
      const f1 = defaultFrames();
      const f2 = defaultFrames();
      const multi: MultiSceneProjectFile = {
        kind: MULTISCENE_PROJECT_KIND,
        version: minimalProject().version,
        savedAt: '2026-01-01T00:00:00.000Z',
        measureConfig: {
          url: 'http://127.0.0.1:8765',
          enabled: true,
          includePreview: false,
        },
        activeSceneId: 's1',
        scenes: [
          {
            id: 's1',
            name: 'One',
            defaults: minimalProject().defaults,
            frames: f1.frames,
            startFrameId: f1.startFrameId,
            items: [],
            audioItems: [
              {
                id: 'track-a',
                text: '',
                audioUrl: 'https://cdn.example/scene-a.webm',
                startTime: 0,
                duration: 1,
              },
            ],
          },
          {
            id: 's2',
            name: 'Two',
            defaults: minimalProject().defaults,
            frames: f2.frames,
            startFrameId: f2.startFrameId,
            items: [],
            audioItems: [
              {
                id: 'track-b',
                text: '',
                audioUrl: 'https://cdn.example/scene-b.webm',
                startTime: 0,
                duration: 1,
              },
            ],
          },
        ],
      };

      const blob = await packMtprojToBlob(multi);
      const out = parseMtprojFromUint8Array(new Uint8Array(await blob.arrayBuffer()));
      expect(isMultiSceneProjectFile(out)).toBe(true);
      if (!isMultiSceneProjectFile(out)) throw new Error('expected multi');
      const a0 = out.scenes[0]!.audioItems![0]!;
      const a1 = out.scenes[1]!.audioItems![0]!;
      expect(a0.audioUrl.startsWith('blob:')).toBe(true);
      expect(a1.audioUrl.startsWith('blob:')).toBe(true);
      expect(a0.assetRelPath).toMatch(/^assets\/audio\//);
      expect(a1.assetRelPath).toMatch(/^assets\/audio\//);
      expect(a0.assetRelPath).not.toBe(a1.assetRelPath);
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });
});
