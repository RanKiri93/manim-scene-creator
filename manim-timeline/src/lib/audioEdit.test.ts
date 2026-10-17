import { describe, expect, it } from 'vitest';
import type { AudioTrackItem } from '@/types/scene';
import {
  copyRange,
  deleteClipRange,
  isEditedClip,
  pasteClips,
  sliceClip,
  splitClip,
  trimClipEnd,
  trimClipStart,
} from './audioEdit';

const words = [
  { word: 'one', start: 0.1, end: 0.5 },
  { word: 'two', start: 0.8, end: 1.2 },
  { word: 'three', start: 1.6, end: 2.4 },
];
const clip = (over: Partial<AudioTrackItem> = {}): AudioTrackItem => ({
  id: 'a',
  text: 'one two three',
  audioUrl: 'u',
  startTime: 10,
  duration: 3,
  boundaries: words,
  fadeInMs: 20,
  ...over,
});
const never = () => false;
let n = 0;
const ids = () => `n${++n}`;

describe('sliceClip / splitClip', () => {
  it('splits into two pieces of the same file, words going to the side holding their middle', () => {
    const [l, r] = splitClip(clip(), 1.1, 'b')!;
    expect(l).toMatchObject({ id: 'a', startTime: 10, duration: 1.1, sourceIn: 0, sourceDuration: 3, fadeInMs: 20 });
    expect(r).toMatchObject({ id: 'b', startTime: 11.1, duration: expect.closeTo(1.9), sourceIn: 1.1, sourceDuration: 3 });
    expect(l.boundaries!.map((w) => w.word)).toEqual(['one', 'two']);
    expect(l.boundaries![1]).toEqual({ word: 'two', start: 0.8, end: 1.1 });
    expect(r.boundaries).toEqual([{ word: 'three', start: expect.closeTo(0.5), end: expect.closeTo(1.3) }]);
    expect(r.text).toBe('three');
  });

  it('refuses a split too close to an edge', () => {
    expect(splitClip(clip(), 0.01, 'b')).toBeNull();
    expect(splitClip(clip(), 2.99, 'b')).toBeNull();
  });

  it('slices a piece of a piece in file terms and drops word_boundaries', () => {
    const piece = sliceClip(clip({ sourceIn: 2, sourceDuration: 8, word_boundaries: words, boundaries: undefined }), 1, 2)!;
    expect(piece.sourceIn).toBe(3);
    expect(piece.sourceDuration).toBe(8);
    expect(piece.word_boundaries).toBeUndefined();
    expect(piece.boundaries!.map((w) => w.word)).toEqual(['two']);
  });
});

describe('trim', () => {
  it('trims the start into the file and back out, limited by the file start', () => {
    const t = trimClipStart(clip(), 10.7);
    expect(t).toMatchObject({ startTime: 10.7, sourceIn: expect.closeTo(0.7), duration: expect.closeTo(2.3) });
    expect(t.boundaries!.map((w) => w.word)).toEqual(['two', 'three']);
    const back = trimClipStart(t, 5);
    expect(back).toMatchObject({ startTime: 10, sourceIn: 0, duration: 3 });
  });

  it('trims the end, limited by the file length and a minimum piece', () => {
    expect(trimClipEnd(clip(), 11.5).duration).toBeCloseTo(1.5);
    expect(trimClipEnd(clip({ sourceDuration: 3.5 }), 20).duration).toBeCloseTo(3.5);
    expect(trimClipEnd(clip(), 9).duration).toBeCloseTo(0.05);
  });

  it('marks edited clips', () => {
    expect(isEditedClip(clip())).toBe(false);
    expect(isEditedClip(trimClipEnd(clip(), 12))).toBe(true);
    expect(isEditedClip(clip({ gainDb: -3 }))).toBe(true);
  });
});

describe('deleteClipRange', () => {
  const later = (over: Partial<AudioTrackItem> = {}): AudioTrackItem => ({ ...clip(), id: 'later', startTime: 15, boundaries: [], ...over });

  it('cuts the range out, closes the gap and pulls unlinked later audio left', () => {
    const res = deleteClipRange([clip(), later(), later({ id: 'linked', startTime: 16 })], 'a', 0.6, 1.4, 'b', (id) => id === 'linked')!;
    const [l, r, lat, linked] = res.audioItems;
    expect(l).toMatchObject({ id: 'a', startTime: 10, duration: expect.closeTo(0.6) });
    expect(r).toMatchObject({ id: 'b', startTime: 10.6, sourceIn: 1.4, duration: expect.closeTo(1.6) });
    expect(r!.boundaries!.map((w) => w.word)).toEqual(['three']);
    expect(lat!.startTime).toBeCloseTo(14.2);
    expect(linked!.startTime).toBe(16);
    expect(res.ripple).toEqual({ at: 11.4, shift: expect.closeTo(-0.8) });
  });

  it('cutting the head keeps the id on the remaining piece', () => {
    const res = deleteClipRange([clip()], 'a', 0, 1, 'b', never)!;
    expect(res.audioItems).toHaveLength(1);
    expect(res.audioItems[0]).toMatchObject({ id: 'a', startTime: 10, sourceIn: 1, duration: 2 });
  });
});

describe('copy / paste', () => {
  const piece = copyRange(clip(), 0.6, 1.4, 'p')!;

  it('copies a range with startTime 0', () => {
    expect(piece).toMatchObject({ startTime: 0, sourceIn: 0.6, duration: expect.closeTo(0.8) });
  });

  it('pastes on top without touching other clips', () => {
    const res = pasteClips([clip()], [piece], 11, 'over', ids, never);
    expect(res.audioItems).toHaveLength(2);
    expect(res.audioItems[0]).toEqual(clip());
    expect(res.audioItems[1]!.startTime).toBe(11);
    expect(res.ripple).toBeNull();
  });

  it('insert splits the clip under the playhead and pushes later unlinked audio', () => {
    const other: AudioTrackItem = { ...clip(), id: 'o', startTime: 20 };
    const res = pasteClips([clip(), other], [piece], 11, 'insert', ids, never);
    const byStart = [...res.audioItems].sort((x, y) => x.startTime - y.startTime);
    expect(byStart.map((x) => [x.startTime, x.duration])).toEqual([
      [10, 1],
      [11, expect.closeTo(0.8)],
      [expect.closeTo(11.8), 2],
      [expect.closeTo(20.8), 3],
    ]);
    expect(res.ripple).toEqual({ at: 11, shift: expect.closeTo(0.8) });
  });
});
