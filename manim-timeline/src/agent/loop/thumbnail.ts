import type { LoopImage } from './types';

/** Width of the thumbnails kept in the Steps list (height follows the picture). */
export const THUMBNAIL_WIDTH = 160;

/**
 * A small JPEG data URL of a picture the Copilot looked at, for its Steps list. Browser only (uses
 * `createImageBitmap` and a canvas); returns null where those are missing or the image is bad.
 */
export async function makeLoopThumbnail(image: LoopImage, width = THUMBNAIL_WIDTH): Promise<string | null> {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return null;
  try {
    const bytes = Uint8Array.from(atob(image.base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: image.mediaType }));
    const scale = Math.min(1, width / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const g = canvas.getContext('2d');
    if (!g) return null;
    g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return null;
  }
}
