import { encodeWavMono, joinChunks, peakDbfs } from '@/lib/wavEncode';

/*
 * Microphone capture for narration. Records uncompressed PCM through an AudioWorklet and saves a
 * 16-bit mono WAV, so nothing is lost before the server cleanup chain and the file has an exact
 * length (Chrome's MediaRecorder webm/opus is lossy and carries no duration). Reports the input
 * peak for a level meter. Falls back to MediaRecorder where AudioWorklet is missing.
 */

export interface MicLevel {
  /** Peak of the last block, dBFS. */
  peakDb: number;
}

export interface MicTake {
  blob: Blob;
  filename: string;
}

export interface MicRecording {
  /** Seconds recorded so far. */
  elapsed: () => number;
  stop: () => Promise<MicTake>;
  cancel: () => void;
}

export function micConstraints(deviceId: string | undefined, browserProcessing: boolean): MediaStreamConstraints {
  // Raw capture by default: browsers otherwise ride the level and smear the noise floor
  // differently on every take (see AudioPanel).
  const dsp = browserProcessing
    ? { noiseSuppression: true, echoCancellation: true, autoGainControl: true }
    : { noiseSuppression: false, echoCancellation: false, autoGainControl: false };
  return { audio: { ...dsp, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) } };
}

/** Audio inputs (labels appear once the page has had mic permission). */
export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'audioinput');
}

const WORKLET = `
class MtRecorder extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.n = 0; }
  process(inputs) {
    const chans = inputs[0];
    if (chans && chans.length) {
      const len = chans[0].length;
      const mono = new Float32Array(len);
      for (const c of chans) for (let i = 0; i < len; i++) mono[i] += c[i] / chans.length;
      this.buf.push(mono);
      this.n += len;
      if (this.n >= 2048) {
        this.port.postMessage(this.buf);
        this.buf = [];
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('mt-recorder', MtRecorder);
`;

export async function startMicRecording(opts: {
  deviceId?: string;
  browserProcessing: boolean;
  onLevel?: (level: MicLevel) => void;
}): Promise<MicRecording> {
  const stream = await navigator.mediaDevices.getUserMedia(micConstraints(opts.deviceId, opts.browserProcessing));
  const stopTracks = () => stream.getTracks().forEach((t) => t.stop());
  if (typeof AudioWorkletNode === 'undefined') return startMediaRecorder(stream, stopTracks);

  const ctx = new AudioContext();
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
  try {
    await ctx.audioWorklet.addModule(url);
  } catch (err) {
    void ctx.close();
    stopTracks();
    throw err;
  } finally {
    URL.revokeObjectURL(url);
  }
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'mt-recorder', { numberOfOutputs: 1 });
  // The worklet only runs while pulled by the destination; a zero gain keeps it silent.
  const sink = ctx.createGain();
  sink.gain.value = 0;
  src.connect(node).connect(sink).connect(ctx.destination);
  const chunks: Float32Array[] = [];
  let samples = 0;
  node.port.onmessage = (ev: MessageEvent<Float32Array[]>) => {
    const block = joinChunks(ev.data);
    chunks.push(block);
    samples += block.length;
    opts.onLevel?.({ peakDb: peakDbfs(block) });
  };
  if (ctx.state === 'suspended') await ctx.resume();

  const teardown = () => {
    node.port.onmessage = null;
    src.disconnect();
    node.disconnect();
    sink.disconnect();
    stopTracks();
    void ctx.close();
  };
  return {
    elapsed: () => samples / ctx.sampleRate,
    stop: async () => {
      const rate = ctx.sampleRate;
      teardown();
      const wav = encodeWavMono(joinChunks(chunks), rate);
      return { blob: new Blob([wav], { type: 'audio/wav' }), filename: 'recording.wav' };
    },
    cancel: teardown,
  };
}

function startMediaRecorder(stream: MediaStream, stopTracks: () => void): MicRecording {
  const rec = new MediaRecorder(stream);
  const parts: BlobPart[] = [];
  const t0 = performance.now();
  rec.ondataavailable = (ev) => {
    if (ev.data.size > 0) parts.push(ev.data);
  };
  rec.start();
  return {
    elapsed: () => (performance.now() - t0) / 1000,
    stop: () =>
      new Promise<MicTake>((resolve) => {
        rec.onstop = () => {
          stopTracks();
          const mime = rec.mimeType || 'audio/webm';
          const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm';
          resolve({ blob: new Blob(parts, { type: mime }), filename: `recording.${ext}` });
        };
        rec.stop();
      }),
    cancel: () => {
      rec.onstop = null;
      if (rec.state !== 'inactive') rec.stop();
      stopTracks();
    },
  };
}
