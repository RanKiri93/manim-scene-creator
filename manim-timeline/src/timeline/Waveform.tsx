import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { peaksForColumns } from '@/lib/waveformPeaks';
import { getWaveformPeaks, loadAudioBuffer, subscribeWaveformPeaks } from './audioBuffers';

/** Widest canvas we draw; wider clips are stretched (Chrome caps canvases near 32k px). */
const MAX_CANVAS_PX = 16384;

interface WaveformProps {
  url: string;
  /** File range shown, in seconds. */
  fromSec: number;
  toSec: number;
  widthPx: number;
  heightPx: number;
  className?: string;
}

/** Quiet raw takes are scaled up to fill the lane, at most this much. */
const MAX_BOOST = 4;

/**
 * Mirrored peak waveform of a slice of an audio file, drawn in the element's text colour and
 * scaled to the file's loudest peak (so a quiet raw take is still readable).
 */
export default function Waveform({ url, fromSec, toSec, widthPx, heightPx, className }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peaks = useSyncExternalStore(subscribeWaveformPeaks, () => getWaveformPeaks(url));

  const scale = useMemo(() => {
    let m = 0;
    if (peaks) for (const v of peaks) if (v > m) m = v;
    return m > 0 ? Math.min(MAX_BOOST, 1 / m) : 1;
  }, [peaks]);

  useEffect(() => {
    if (url) void loadAudioBuffer(url);
  }, [url]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || widthPx <= 0 || heightPx <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.min(MAX_CANVAS_PX, Math.round(widthPx * dpr)));
    const h = Math.max(1, Math.round(heightPx * dpr));
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, w, h);
    g.fillStyle = getComputedStyle(canvas).color;
    const cols = peaksForColumns(peaks, fromSec, toSec, w);
    const mid = h / 2;
    for (let x = 0; x < w; x++) {
      const half = Math.max(0.5, Math.min(1, cols[x]! * scale) * mid);
      g.fillRect(x, mid - half, 1, half * 2);
    }
  }, [peaks, scale, fromSec, toSec, widthPx, heightPx]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      style={{ width: `${widthPx}px`, height: `${heightPx}px` }}
    />
  );
}
