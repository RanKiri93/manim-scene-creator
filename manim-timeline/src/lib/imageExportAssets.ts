import type { ImageItem, SceneItem } from '@/types/scene';

/**
 * Export-only preparation for `image` items whose `srcUrl` is a live browser
 * URL. Manim codegen (`imageCodegen.ts`) can only emit a real file path
 * (`assetRelPath` / `assets/textures/...`) or an embedded
 * `data:image/...;base64` URL — a `blob:` URL points at browser memory and a
 * remote `http(s):` URL may not exist where Manim runs. This helper fetches
 * those bytes and rewrites them as `data:` URLs on **clones**, so the Zustand
 * store and persisted project shape are never touched.
 */

/** Refuse to inline images larger than this (keeps preview Python usable). */
export const MAX_EXPORT_IMAGE_BYTES = 8 * 1024 * 1024;

const DATA_URL_PREFIX_RE = /^data:(image\/(png|jpeg|jpg|gif));base64,/i;
const LIVE_URL_RE = /^(blob:|https?:\/\/)/i;

/**
 * True when this item needs export preparation: a live `blob:`/`http(s):`
 * `srcUrl` with no pinned bundle path. Everything else (pinned
 * `assetRelPath`, virtual `assets/textures/...`, existing `data:` URLs, other
 * schemes, non-images) is left for codegen to handle as before.
 */
export function imageNeedsExportPreparation(
  item: SceneItem,
): item is ImageItem {
  if (item.kind !== 'image') return false;
  if (item.assetRelPath?.trim()) return false;
  const src = item.srcUrl.trim();
  if (!src) return false;
  if (src.startsWith('assets/textures/')) return false;
  if (DATA_URL_PREFIX_RE.test(src)) return false;
  return LIVE_URL_RE.test(src);
}

function normalizeExportImageMime(
  value: string | null | undefined,
): string | null {
  const m = (value ?? '').split(';')[0]?.trim().toLowerCase();
  if (m === 'image/png') return 'image/png';
  if (m === 'image/jpeg' || m === 'image/jpg') return 'image/jpeg';
  if (m === 'image/gif') return 'image/gif';
  return null;
}

/** MIME from an explicit image extension only — unknown extensions must error, not mislabel. */
function mimeFromFileName(fileName: string): string | null {
  const low = fileName.toLowerCase();
  if (low.endsWith('.png')) return 'image/png';
  if (low.endsWith('.jpg') || low.endsWith('.jpeg')) return 'image/jpeg';
  if (low.endsWith('.gif')) return 'image/gif';
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

const dataUrlCache = new Map<string, Promise<string>>();

/** Test-only: drop cached conversions so fetch mocks can be re-observed. */
export function clearImageExportAssetCacheForTests(): void {
  dataUrlCache.clear();
}

async function fetchImageDataUrl(item: ImageItem): Promise<string> {
  const src = item.srcUrl.trim();
  const label = item.label || item.fileName || item.id;
  let resp: Response;
  try {
    resp = await fetch(src);
  } catch (e) {
    throw new Error(
      `Image "${label}" could not be read for Manim export (${e instanceof Error ? e.message : String(e)}).`,
    );
  }
  if (!resp.ok) {
    throw new Error(
      `Image "${label}" could not be read for Manim export (HTTP ${resp.status}).`,
    );
  }
  const bytes = new Uint8Array(await resp.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error(
      `Image "${label}" is empty, so it cannot be embedded for Manim export.`,
    );
  }
  if (bytes.length > MAX_EXPORT_IMAGE_BYTES) {
    throw new Error(
      `Image "${label}" is ${(bytes.length / 1048576).toFixed(1)} MB; export embeds images up to 8 MB. Use a smaller image file.`,
    );
  }
  const mime =
    normalizeExportImageMime(item.mimeType) ??
    normalizeExportImageMime(resp.headers.get('content-type')) ??
    mimeFromFileName(item.fileName);
  if (!mime) {
    throw new Error(
      `Image "${label}" has an unsupported image type for Manim export. Use PNG, JPG, or GIF.`,
    );
  }
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

/**
 * Return an export-ready item list: `image` items with live `blob:`/`http(s):`
 * URLs are replaced by clones carrying `data:image/...;base64` URLs (cached
 * per source URL). Input objects are never mutated; when nothing needs
 * conversion the input array is returned as-is. Rejects with a human-readable
 * error naming the offending image when bytes cannot be fetched or embedded.
 */
export async function prepareImageItemsForManimExport(
  items: readonly SceneItem[],
): Promise<SceneItem[]> {
  let changed = false;
  const out = await Promise.all(
    items.map(async (it) => {
      if (!imageNeedsExportPreparation(it)) return it;
      const src = it.srcUrl.trim();
      let pending = dataUrlCache.get(src);
      if (!pending) {
        pending = fetchImageDataUrl(it);
        dataUrlCache.set(src, pending);
        pending.catch(() => {
          if (dataUrlCache.get(src) === pending) dataUrlCache.delete(src);
        });
      }
      const dataUrl = await pending;
      changed = true;
      return { ...it, srcUrl: dataUrl };
    }),
  );
  return changed ? out : (items as SceneItem[]);
}
