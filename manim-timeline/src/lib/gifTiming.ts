/**
 * Animated-GIF timing shared by the canvas preview and the Manim export.
 *
 * A GIF plays in a loop from the moment its image object appears, for as long as it is on
 * screen. Frame delays follow the browser rule: a delay of 10 ms or less plays as 100 ms.
 * The export reads the same delays with Pillow and applies the same rule
 * (`_ManimUIGif` in `codegen/imageCodegen.ts`), so preview and render show the same frame.
 */

/** Browsers play a GIF frame delay of 10 ms or less (including a missing delay) as 100 ms. */
export function normalizeGifDelayMs(rawMs: number): number {
  return Number.isFinite(rawMs) && rawMs > 10 ? rawMs : 100;
}

export function isGifImage(item: { mimeType?: string; fileName?: string; srcUrl?: string }): boolean {
  return (
    item.mimeType?.toLowerCase() === 'image/gif' ||
    /\.gif$/i.test(item.fileName ?? '') ||
    /^data:image\/gif[;,]/i.test(item.srcUrl ?? '')
  );
}

/**
 * Per-frame delays (ms, normalized) read from the GIF's graphic control extensions, one per
 * image descriptor. Returns `[]` for data that is not a GIF.
 */
export function parseGifFrameDelaysMs(bytes: Uint8Array): number[] {
  const ascii = String.fromCharCode(...bytes.subarray(0, 6));
  if (ascii !== 'GIF87a' && ascii !== 'GIF89a') return [];
  let i = 13;
  const screenFlags = bytes[10] ?? 0;
  if (screenFlags & 0x80) i += 3 * (1 << ((screenFlags & 7) + 1));
  const skipSubBlocks = () => {
    while (i < bytes.length) {
      const size = bytes[i++]!;
      if (size === 0) return;
      i += size;
    }
  };
  const delays: number[] = [];
  let pending: number | null = null;
  while (i < bytes.length) {
    const block = bytes[i++];
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = bytes[i++];
      if (label === 0xf9 && bytes[i] === 4) {
        pending = ((bytes[i + 2] ?? 0) | ((bytes[i + 3] ?? 0) << 8)) * 10;
        i += 5;
        skipSubBlocks();
      } else {
        skipSubBlocks();
      }
    } else if (block === 0x2c) {
      const flags = bytes[i + 8] ?? 0;
      i += 9;
      if (flags & 0x80) i += 3 * (1 << ((flags & 7) + 1));
      i += 1; // LZW minimum code size
      skipSubBlocks();
      delays.push(normalizeGifDelayMs(pending ?? 0));
      pending = null;
    } else {
      break;
    }
  }
  return delays;
}

/** Frame shown `elapsedSec` after the image appeared, looping; frame 0 before it appears. */
export function gifFrameIndexAt(elapsedSec: number, delaysMs: readonly number[]): number {
  if (delaysMs.length <= 1 || !(elapsedSec > 0)) return 0;
  const total = delaysMs.reduce((a, b) => a + b, 0);
  let t = (elapsedSec * 1000) % total;
  for (let i = 0; i < delaysMs.length; i++) {
    t -= delaysMs[i]!;
    if (t < 0) return i;
  }
  return delaysMs.length - 1;
}
