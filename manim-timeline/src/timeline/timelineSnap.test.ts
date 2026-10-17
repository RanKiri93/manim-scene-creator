import { describe, expect, it } from 'vitest';
import type { AudioTrackItem } from '@/types/scene';
import { collectSnapTargets, snapEdges } from './timelineSnap';

const voice: AudioTrackItem = {
  id: 'v',
  text: '',
  audioUrl: 'u',
  startTime: 10,
  duration: 3,
  boundaries: [
    { word: 'one', start: 0.1, end: 0.5 },
    { word: 'two', start: 1, end: 1.4 },
  ],
};

describe('snap targets', () => {
  const targets = collectSnapTargets({ audioItems: [voice], items: [], itemsMap: new Map(), playhead: 4 });

  it('has the playhead, word starts (anchorable) and ends, and narration edges', () => {
    expect(targets.map((t) => [t.t, t.label])).toEqual([
      [4, 'playhead'],
      [10.1, 'one'],
      [10.5, 'one (end)'],
      [11, 'two'],
      [11.4, 'two (end)'],
      [10, 'narration start'],
      [13, 'narration end'],
    ]);
    expect(targets[3]!.word).toEqual({ trackId: 'v', wordIndex: 1 });
  });

  it('snaps whichever edge is closest, within the threshold', () => {
    // start at 10.95 → word "two" at 11; end at 12.45 is far from everything.
    expect(snapEdges([10.95, 12.45], targets, 0.1)).toMatchObject({ delta: expect.closeTo(0.05), edgeIndex: 0 });
    // end at 12.98 → narration end 13.
    expect(snapEdges([11.5, 12.98], targets, 0.1)).toMatchObject({ delta: expect.closeTo(0.02), edgeIndex: 1 });
    expect(snapEdges([7, 8], targets, 0.1)).toBeNull();
  });

  it('prefers starting on a word when two targets are equally close', () => {
    const tied = [{ t: 5, label: 'clip end' }, { t: 5, label: 'w', word: { trackId: 'v', wordIndex: 0 } }];
    expect(snapEdges([5.05], tied, 0.1)!.target.label).toBe('w');
  });
});
