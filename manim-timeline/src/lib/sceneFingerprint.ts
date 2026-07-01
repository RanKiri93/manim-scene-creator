import * as SparkMd5Pkg from 'spark-md5';
import type { SceneDiskPayload } from '@/store/useSceneStore';

function sparkMd5ArrayBuffer(): {
  hash(buf: ArrayBuffer, raw?: boolean): string;
} {
  const p = SparkMd5Pkg as unknown as {
    default?: { ArrayBuffer: { hash(buf: ArrayBuffer, raw?: boolean): string } };
    ArrayBuffer?: { hash(buf: ArrayBuffer, raw?: boolean): string };
  };
  if (p.default?.ArrayBuffer && typeof p.default.ArrayBuffer.hash === 'function') {
    return p.default.ArrayBuffer;
  }
  if (p.ArrayBuffer && typeof p.ArrayBuffer.hash === 'function') {
    return p.ArrayBuffer;
  }
  throw new Error('spark-md5 failed to load');
}

/** Stable fingerprint for stale-render detection (excluding scene id/tab name). */
export function fingerprintSceneDiskPayload(payload: SceneDiskPayload): string {
  const canonical = JSON.stringify({
    defaults: payload.defaults,
    frames: payload.frames,
    startFrameId: payload.startFrameId,
    items: payload.items,
    audio: payload.audioItems ?? [],
    audioBed: payload.audioBed ?? null,
  });
  const enc = new TextEncoder().encode(canonical);
  const copy = new Uint8Array(enc.byteLength);
  copy.set(enc);
  return sparkMd5ArrayBuffer().hash(copy.buffer, false);
}
