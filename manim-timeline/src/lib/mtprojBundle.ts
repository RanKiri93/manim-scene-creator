import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import * as SparkMd5Pkg from 'spark-md5';
import type { ProjectFile, AudioTrackItem } from '@/types/scene';
import { deriveAudioAssetRelPath, isBundledVirtualAudioUrl } from '@/lib/audioAssetPath';
import {
  MtprojPackError,
  MtprojUnpackError,
  MTPROJ_BUNDLE_FORMAT_VERSION,
} from '@/lib/mtprojErrors';

export { MTPROJ_BUNDLE_FORMAT_VERSION };

export interface MtprojManifest {
  bundleFormatVersion: number;
  /** Relative zip path → lowercase MD5 hex of file bytes */
  assets: Record<string, string>;
}

function sparkMd5Root(): {
  ArrayBuffer: { hash(buf: ArrayBuffer, raw?: boolean): string };
} {
  const p = SparkMd5Pkg as unknown as {
    default?: { ArrayBuffer: { hash(buf: ArrayBuffer, raw?: boolean): string } };
    ArrayBuffer?: { hash(buf: ArrayBuffer, raw?: boolean): string };
  };
  if (p.default?.ArrayBuffer && typeof p.default.ArrayBuffer.hash === 'function') {
    return p.default;
  }
  if (p.ArrayBuffer && typeof p.ArrayBuffer.hash === 'function') {
    return p as { ArrayBuffer: { hash(buf: ArrayBuffer, raw?: boolean): string } };
  }
  throw new Error('spark-md5 failed to load');
}

function md5Hex(data: Uint8Array): string {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return sparkMd5Root().ArrayBuffer.hash(copy.buffer, false) as string;
}

function guessAudioMime(path: string): string {
  const low = path.toLowerCase();
  if (low.endsWith('.mp3')) return 'audio/mpeg';
  if (low.endsWith('.wav')) return 'audio/wav';
  if (low.endsWith('.webm')) return 'audio/webm';
  if (low.endsWith('.m4a')) return 'audio/mp4';
  if (low.endsWith('.ogg')) return 'audio/ogg';
  if (low.endsWith('.flac')) return 'audio/flac';
  if (low.endsWith('.opus')) return 'audio/opus';
  if (low.endsWith('.aac')) return 'audio/aac';
  return 'application/octet-stream';
}

function allocateBundleAudioPath(track: AudioTrackItem, used: Set<string>): string {
  let rel = deriveAudioAssetRelPath(track);
  if (!used.has(rel)) {
    used.add(rel);
    return rel;
  }
  const slash = rel.lastIndexOf('/');
  const dir = slash >= 0 ? rel.slice(0, slash + 1) : '';
  const file = slash >= 0 ? rel.slice(slash + 1) : rel;
  const dot = file.lastIndexOf('.');
  const stem = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : '';
  rel = `${dir}${stem}_${track.id.slice(0, 8)}${ext}`;
  if (!used.has(rel)) {
    used.add(rel);
    return rel;
  }
  rel = `${dir}${stem}_${track.id}${ext}`;
  used.add(rel);
  return rel;
}

async function fetchUrlBytes(url: string): Promise<Uint8Array> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  const buf = await resp.arrayBuffer();
  return new Uint8Array(buf);
}

function deepCloneProject(project: ProjectFile): ProjectFile {
  return structuredClone(project) as ProjectFile;
}

/**
 * Build a .mtproj ZIP blob: `state.json`, `manifest.json`, `assets/audio/*`.
 */
export async function packMtprojToBlob(project: ProjectFile): Promise<Blob> {
  const state = deepCloneProject(project);
  const audioItems = state.audioItems ?? [];
  const usedPaths = new Set<string>();
  const zipMap: Record<string, Uint8Array> = {};
  const manifest: MtprojManifest = {
    bundleFormatVersion: MTPROJ_BUNDLE_FORMAT_VERSION,
    assets: {},
  };
  const failed: { trackId: string; text: string; reason: string }[] = [];

  for (const track of audioItems) {
    const sourceUrl = track.audioUrl;
    if (isBundledVirtualAudioUrl(sourceUrl)) {
      failed.push({
        trackId: track.id,
        text: track.text,
        reason: 'audio is already a bundle path (missing live blob or HTTP URL)',
      });
      continue;
    }
    const rel = allocateBundleAudioPath(track, usedPaths);
    try {
      const bytes = await fetchUrlBytes(sourceUrl);
      zipMap[rel] = bytes;
      manifest.assets[rel] = md5Hex(bytes);
      track.audioUrl = rel;
      track.assetRelPath = rel;
    } catch (e) {
      failed.push({
        trackId: track.id,
        text: track.text,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (failed.length > 0) {
    throw new MtprojPackError(
      `Could not embed ${failed.length} audio track(s). Fix URLs or network/CORS, then try again.`,
      failed,
    );
  }

  zipMap['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  zipMap['state.json'] = strToU8(JSON.stringify(state, null, 2));

  const zipped = zipSync(zipMap, { level: 6 });
  return new Blob([new Uint8Array(zipped)], { type: 'application/zip' });
}

function parseManifest(raw: string): MtprojManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MtprojUnpackError('manifest.json is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new MtprojUnpackError('manifest.json has invalid shape');
  }
  const o = parsed as Record<string, unknown>;
  if (o.bundleFormatVersion !== MTPROJ_BUNDLE_FORMAT_VERSION) {
    throw new MtprojUnpackError(
      `Unsupported bundle format version: ${String(o.bundleFormatVersion)} (expected ${MTPROJ_BUNDLE_FORMAT_VERSION})`,
    );
  }
  if (!o.assets || typeof o.assets !== 'object' || Array.isArray(o.assets)) {
    throw new MtprojUnpackError('manifest.json missing "assets" object');
  }
  const assets: Record<string, string> = {};
  for (const [k, v] of Object.entries(o.assets as Record<string, unknown>)) {
    if (typeof v !== 'string' || !/^[a-f0-9]{32}$/i.test(v)) {
      throw new MtprojUnpackError(`Invalid MD5 for asset "${k}"`);
    }
    assets[k] = v.toLowerCase();
  }
  return { bundleFormatVersion: MTPROJ_BUNDLE_FORMAT_VERSION, assets };
}

function rehydrateAudioFromZip(
  state: ProjectFile,
  files: Record<string, Uint8Array>,
  manifest: MtprojManifest,
): void {
  const items = state.audioItems ?? [];
  for (const track of items) {
    const url = track.audioUrl.split('?')[0];
    if (!isBundledVirtualAudioUrl(url)) continue;
    if (!(url in manifest.assets)) {
      throw new MtprojUnpackError(
        `state.json references "${url}" but it is not listed in manifest.json`,
      );
    }
    const bytes = files[url];
    if (!bytes) {
      throw new MtprojUnpackError(`Missing asset in archive: ${url}`);
    }
    const mime = guessAudioMime(url);
    const blob = new Blob([new Uint8Array(bytes)], { type: mime });
    track.assetRelPath = url;
    track.audioUrl = URL.createObjectURL(blob);
  }
}

function verifyManifest(files: Record<string, Uint8Array>, manifest: MtprojManifest): void {
  for (const [relPath, expectedMd5] of Object.entries(manifest.assets)) {
    const data = files[relPath];
    if (!data) {
      throw new MtprojUnpackError(
        `Checksum manifest references missing file: ${relPath}`,
      );
    }
    const actual = md5Hex(data);
    if (actual !== expectedMd5) {
      throw new MtprojUnpackError(
        `Asset failed checksum (corrupt or altered): ${relPath}`,
      );
    }
  }
}

/**
 * Parse a .mtproj ZIP buffer and return a `ProjectFile` with blob `audioUrl`s.
 */
export function parseMtprojFromUint8Array(zipBytes: Uint8Array): ProjectFile {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zipBytes);
  } catch {
    throw new MtprojUnpackError('File is not a valid ZIP archive');
  }

  const stateRaw = files['state.json'];
  if (!stateRaw) {
    throw new MtprojUnpackError('Archive missing state.json');
  }
  const manifestRaw = files['manifest.json'];
  if (!manifestRaw) {
    throw new MtprojUnpackError('Archive missing manifest.json');
  }

  const manifest = parseManifest(strFromU8(manifestRaw));
  verifyManifest(files, manifest);

  let state: ProjectFile;
  try {
    state = JSON.parse(strFromU8(stateRaw)) as ProjectFile;
  } catch {
    throw new MtprojUnpackError('state.json is not valid JSON');
  }

  rehydrateAudioFromZip(state, files, manifest);
  return state;
}

export async function parseMtprojFromFile(file: File): Promise<ProjectFile> {
  const buf = new Uint8Array(await file.arrayBuffer());
  return parseMtprojFromUint8Array(buf);
}
