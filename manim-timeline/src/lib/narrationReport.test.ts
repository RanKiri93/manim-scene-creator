import { describe, expect, it } from 'vitest';
import type { AudioTrackItem } from '@/types/scene';
import { narrationReport } from './narrationReport';

const track = (words: [string, number, number][], over: Partial<AudioTrackItem> = {}): AudioTrackItem => ({
  id: 'v',
  text: '',
  audioUrl: 'u',
  startTime: 10,
  duration: 12,
  boundaries: words.map(([word, start, end]) => ({ word, start, end })),
  ...over,
});

describe('narrationReport', () => {
  it('finds long pauses (with clip-edge silence) and cuts that keep half a second', () => {
    const r = narrationReport([track([['שלום', 0.2, 0.6], ['לכולם', 3.0, 3.5]], { duration: 6 })]);
    expect(r.pauses).toEqual([
      { trackId: 'v', seconds: 2.4, from: 10.85, to: 12.75, after: 'שלום', before: 'לכולם' },
      { trackId: 'v', seconds: 2.5, from: 13.75, to: 16, after: 'לכולם', before: '' },
    ]);
  });

  it('finds filler words with cuts in the pauses around them', () => {
    const r = narrationReport([track([['נגדיר', 0, 0.5], ['אה,', 0.9, 1.1], ['פונקציה', 1.5, 2]])]);
    expect(r.fillers).toEqual([{ trackId: 'v', text: 'אה,', at: 10.9, from: 10.7, to: 11.3 }]);
  });

  it('finds a phrase said twice in a row and cuts the first saying', () => {
    const r = narrationReport([
      track([
        ['the', 0, 0.2],
        ['derivative', 0.3, 0.8],
        ['the', 1.0, 1.2],
        ['derivative', 1.3, 1.8],
        ['is', 2, 2.2],
      ]),
    ]);
    expect(r.repeats).toEqual([{ trackId: 'v', text: 'the derivative', at: 10, from: 10, to: 10.9 }]);
  });

  it('reports measured loudness spread', () => {
    const meta = (lufs: number) => ({ normalized: { targetLufs: -16, measuredOutputLufs: lufs, processedAt: '' } });
    const r = narrationReport([
      track([], { id: 'a', audioProcessing: meta(-16) }),
      track([], { id: 'b', audioProcessing: meta(-19.5) }),
    ]);
    expect(r.loudnessSpread).toBe(3.5);
    expect(r.tracks.map((t) => t.lufs)).toEqual([-16, -19.5]);
  });
});
