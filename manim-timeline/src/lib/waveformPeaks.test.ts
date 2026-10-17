import { describe, expect, it } from 'vitest';
import { computePeaks, peaksForColumns } from './waveformPeaks';

describe('waveform peaks', () => {
  it('takes the max |sample| per bin over all channels', () => {
    const l = new Float32Array([0.1, -0.5, 0.2, 0, 0, 0.3]);
    const r = new Float32Array([0, 0, -0.9, 0, 0, 0]);
    expect([...computePeaks([l, r], 4, 2)]).toEqual([
      expect.closeTo(0.5, 6),
      expect.closeTo(0.9, 6),
      expect.closeTo(0.3, 6),
    ]);
  });

  it('maps a file range onto columns', () => {
    const peaks = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]); // 2 per second
    expect([...peaksForColumns(peaks, 1, 3, 2, 2)]).toEqual([
      expect.closeTo(0.4, 6),
      expect.closeTo(0.6, 6),
    ]);
    // More columns than bins: each column still reads the bin it falls in.
    expect([...peaksForColumns(peaks, 0, 1, 4, 2)]).toEqual([
      expect.closeTo(0.1, 6),
      expect.closeTo(0.1, 6),
      expect.closeTo(0.2, 6),
      expect.closeTo(0.2, 6),
    ]);
  });
});
