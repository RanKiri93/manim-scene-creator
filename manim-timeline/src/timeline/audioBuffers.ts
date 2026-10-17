import { computePeaks } from '@/lib/waveformPeaks';

/*
 * One AudioContext for the editor and a decode cache keyed by audio URL, shared by timeline
 * playback (`timelineAudioController`) and the clip waveforms. Waveform peaks are computed once
 * per decoded file; components subscribe to learn when they arrive.
 */

let ctx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
const peaks = new Map<string, Float32Array>();
const listeners = new Set<() => void>();

type Loader = (url: string, ctx: AudioContext) => Promise<AudioBuffer | null>;

const fetchAndDecode: Loader = async (url, c) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return c.decodeAudioData(await res.arrayBuffer());
};
let loader: Loader = fetchAndDecode;

export function getAudioContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor =
    typeof window !== 'undefined'
      ? window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

/** Decoded file (cached, also on failure → null). Computes waveform peaks on first load. */
export function loadAudioBuffer(url: string): Promise<AudioBuffer | null> {
  const hit = buffers.get(url);
  if (hit) return hit;
  const c = getAudioContext();
  if (!c) return Promise.resolve(null);
  const p = loader(url, c)
    .then((buf) => {
      if (buf) {
        const chans: Float32Array[] = [];
        for (let i = 0; i < buf.numberOfChannels; i++) chans.push(buf.getChannelData(i));
        peaks.set(url, computePeaks(chans, buf.sampleRate));
        for (const l of listeners) l();
      }
      return buf;
    })
    .catch((err) => {
      console.warn('Audio decode failed:', url, err);
      return null;
    });
  buffers.set(url, p);
  return p;
}

/** Waveform peaks for a file once decoded (see `PEAKS_PER_SECOND`); undefined before. */
export function getWaveformPeaks(url: string): Float32Array | undefined {
  return peaks.get(url);
}

export function subscribeWaveformPeaks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** @internal Vitest only */
export function setAudioBuffersForTests(opts: { ctx: AudioContext | null; loader?: Loader }) {
  ctx = opts.ctx;
  loader = opts.loader ?? fetchAndDecode;
  buffers.clear();
  peaks.clear();
}
