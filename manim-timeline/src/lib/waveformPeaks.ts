/** Peak bins per second of audio kept for drawing waveforms (5 ms each). */
export const PEAKS_PER_SECOND = 200;

/** Max |sample| over all channels for each bin of `1 / perSecond` seconds. */
export function computePeaks(
  channels: readonly Float32Array[],
  sampleRate: number,
  perSecond = PEAKS_PER_SECOND,
): Float32Array {
  const length = channels[0]?.length ?? 0;
  const binSize = Math.max(1, Math.round(sampleRate / perSecond));
  const bins = Math.ceil(length / binSize);
  const out = new Float32Array(bins);
  for (const ch of channels) {
    for (let b = 0; b < bins; b++) {
      const end = Math.min(length, (b + 1) * binSize);
      let m = out[b]!;
      for (let i = b * binSize; i < end; i++) {
        const v = Math.abs(ch[i]!);
        if (v > m) m = v;
      }
      out[b] = m;
    }
  }
  return out;
}

/** One value per column for the file range [fromSec, toSec): the max of the bins it covers. */
export function peaksForColumns(
  peaks: Float32Array,
  fromSec: number,
  toSec: number,
  columns: number,
  perSecond = PEAKS_PER_SECOND,
): Float32Array {
  const out = new Float32Array(Math.max(0, columns));
  if (columns <= 0 || toSec <= fromSec) return out;
  const span = (toSec - fromSec) / columns;
  for (let c = 0; c < columns; c++) {
    const b0 = Math.floor((fromSec + c * span) * perSecond);
    const b1 = Math.max(b0 + 1, Math.ceil((fromSec + (c + 1) * span) * perSecond));
    let m = 0;
    for (let b = Math.max(0, b0); b < Math.min(peaks.length, b1); b++) {
      if (peaks[b]! > m) m = peaks[b]!;
    }
    out[c] = m;
  }
  return out;
}
