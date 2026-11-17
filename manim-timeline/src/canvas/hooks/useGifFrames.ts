import { useEffect, useState } from 'react';
import { parseGifFrameDelaysMs } from '@/lib/gifTiming';

export interface GifFrames {
  frames: ImageBitmap[];
  delaysMs: number[];
}

interface ImageDecoderLike {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  completed: Promise<void>;
  decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>;
  close(): void;
}
type ImageDecoderCtor = new (init: { data: ArrayBuffer; type: string }) => ImageDecoderLike;

/**
 * Decoded frames of an animated GIF, for the canvas preview to show the frame the export shows.
 * Null while loading, for a still GIF, or where the browser has no `ImageDecoder`
 * (the image then previews as its first frame).
 */
export function useGifFrames(srcUrl: string, enabled: boolean): GifFrames | null {
  const [state, setState] = useState<{ src: string; gif: GifFrames | null } | null>(null);

  useEffect(() => {
    const Decoder = (globalThis as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder;
    if (!enabled || !Decoder) return;
    let cancelled = false;
    const bitmaps: ImageBitmap[] = [];
    void (async () => {
      try {
        const data = await (await fetch(srcUrl)).arrayBuffer();
        const delaysMs = parseGifFrameDelaysMs(new Uint8Array(data));
        if (delaysMs.length <= 1) return;
        const decoder = new Decoder({ data, type: 'image/gif' });
        try {
          await decoder.tracks.ready;
          await decoder.completed;
          const count = Math.min(decoder.tracks.selectedTrack?.frameCount ?? 0, delaysMs.length);
          for (let i = 0; i < count && !cancelled; i++) {
            const { image } = await decoder.decode({ frameIndex: i });
            try {
              bitmaps.push(await createImageBitmap(image));
            } finally {
              image.close();
            }
          }
        } finally {
          decoder.close();
        }
        if (!cancelled && bitmaps.length > 1) {
          setState({ src: srcUrl, gif: { frames: bitmaps, delaysMs: delaysMs.slice(0, bitmaps.length) } });
        }
      } catch {
        // Undecodable: keep the still preview.
      }
    })();
    return () => {
      cancelled = true;
      for (const b of bitmaps) b.close();
    };
  }, [srcUrl, enabled]);

  return enabled && state?.src === srcUrl ? state.gif : null;
}
