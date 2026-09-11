/** Still-picture extensions accepted by the editor (GIF imports as a still). */
export const SUPPORTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif'] as const;

export type SupportedImageExtension =
  (typeof SUPPORTED_IMAGE_EXTENSIONS)[number];

/** Max Manim-unit extent when fitting an import (aspect preserved). */
export const IMAGE_IMPORT_MAX_DIM = 3;

function extensionOf(name: string): string {
  const low = name.toLowerCase();
  const dot = low.lastIndexOf('.');
  return dot >= 0 ? low.slice(dot) : '';
}

/** Lowercase supported extension for a file name, or null when unsupported. */
export function supportedImageExtension(
  fileName: string,
): SupportedImageExtension | null {
  const ext = extensionOf(fileName.trim());
  return (
    SUPPORTED_IMAGE_EXTENSIONS as readonly string[]
  ).includes(ext)
    ? (ext as SupportedImageExtension)
    : null;
}

/** True for `image/png`, `image/jpeg`, `image/gif` uploads with a supported name. */
export function isSupportedImageFile(file: {
  name: string;
  type?: string;
}): boolean {
  if (!supportedImageExtension(file.name)) return false;
  const t = (file.type ?? '').toLowerCase().trim();
  if (!t) return true;
  return t === 'image/png' || t === 'image/jpeg' || t === 'image/gif';
}

function sanitizeBase(name: string, fallback: string): string {
  const q = name.split('?')[0];
  const parts = q.split('/').filter(Boolean);
  let base = parts.length > 0 ? parts[parts.length - 1]! : fallback;
  base = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!base) base = fallback;
  return base;
}

/**
 * Stable `assets/textures/...` path for `.mtproj` and Manim export.
 * When `assetRelPath` is set (e.g. after loading a bundle), it wins.
 * Unknown extensions fall back to `.png` so Manim always sees an image suffix.
 */
export function deriveImageAssetRelPath(item: {
  assetRelPath?: string;
  srcUrl: string;
  fileName: string;
  id?: string;
}): string {
  const pinned = item.assetRelPath?.trim().replace(/^\/+/, '');
  if (pinned) return pinned;

  const fallback = `image_${(item.id ?? 'img').slice(0, 8)}.png`;
  let base = sanitizeBase(item.fileName.trim() || item.srcUrl, fallback);
  const lower = base.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot) : '';
  if (
    !(SUPPORTED_IMAGE_EXTENSIONS as readonly string[]).includes(ext)
  ) {
    const stem = dot >= 0 ? base.slice(0, dot) : base;
    base = `${stem.length > 0 ? stem : fallback.replace(/\.png$/, '')}.png`;
  }
  return `assets/textures/${base}`;
}

/** True for virtual in-archive texture paths (not yet rehydrated to blob URLs). */
export function isBundledVirtualImageUrl(url: string): boolean {
  const u = url.split('?')[0].trim();
  return u.startsWith('assets/textures/');
}

/** Blob MIME type for rehydrated texture bytes. */
export function guessImageMime(path: string): string {
  const low = path.toLowerCase();
  if (low.endsWith('.jpg') || low.endsWith('.jpeg')) return 'image/jpeg';
  if (low.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

/**
 * Fit pixel dimensions into Manim units, preserving aspect ratio so the
 * longest side is `IMAGE_IMPORT_MAX_DIM` units.
 */
export function fitImageToManimSize(
  pxWidth: number,
  pxHeight: number,
  maxDim = IMAGE_IMPORT_MAX_DIM,
): { width: number; height: number } {
  const w = Number.isFinite(pxWidth) && pxWidth > 0 ? pxWidth : 1;
  const h = Number.isFinite(pxHeight) && pxHeight > 0 ? pxHeight : 1;
  const longest = Math.max(w, h);
  const s = maxDim / longest;
  return {
    width: Math.max(0.05, w * s),
    height: Math.max(0.05, h * s),
  };
}

/** Clamp opacity into `[0, 1]`; non-finite values become fully opaque. */
export function clampImageOpacity(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.max(0, Math.min(1, v));
}
