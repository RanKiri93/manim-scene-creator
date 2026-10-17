import { describe, expect, it } from 'vitest';
import { encodeWavMono, joinChunks, peakDbfs } from './wavEncode';

describe('wav encode', () => {
  it('writes a 16-bit mono PCM header and clamped samples', () => {
    const buf = encodeWavMono(new Float32Array([0, 1, -1, 2]), 48000);
    const v = new DataView(buf);
    const tag = (o: number) => String.fromCharCode(...new Uint8Array(buf, o, 4));
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(8);
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767]);
  });

  it('joins chunks and measures peaks', () => {
    expect([...joinChunks([new Float32Array([1, 2]), new Float32Array([3])])]).toEqual([1, 2, 3]);
    expect(peakDbfs(new Float32Array([0.5, -1]))).toBeCloseTo(0);
    expect(peakDbfs(new Float32Array([0.1]))).toBeCloseTo(-20);
    expect(peakDbfs(new Float32Array(4))).toBe(-Infinity);
  });
});
