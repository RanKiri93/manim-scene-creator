import { describe, expect, it } from 'vitest';
import type { AudioTrackItem } from '@/types/scene';
import {
  clipLanguage,
  clipPieces,
  copyRange,
  deleteClipRange,
  isEditedClip,
  pasteClips,
  punchInClip,
  sliceClip,
  splitClip,
  trimClipEnd,
  trimClipStart,
  wordRangeCut,
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

  it('cuts the range out, closes the gap as one clip and pulls unlinked later audio left', () => {
    const res = deleteClipRange([clip(), later(), later({ id: 'linked', startTime: 16 })], 'a', 0.6, 1.4, 'b', (id) => id === 'linked')!;
    const [kept, lat, linked] = res.audioItems;
    expect(res.audioItems).toHaveLength(3);
    expect(kept).toMatchObject({ id: 'a', startTime: 10, sourceIn: 0, duration: expect.closeTo(2.2) });
    expect(kept!.pieces).toEqual([
      { sourceIn: 0, duration: expect.closeTo(0.6) },
      { sourceIn: 1.4, duration: expect.closeTo(1.6) },
    ]);
    expect(kept!.boundaries!.map((w) => w.word)).toEqual(['one', 'three']);
    expect(kept!.boundaries![1]!.start).toBeCloseTo(clip().boundaries![2]!.start - 0.8);
    expect(clipPieces(kept!).map((p) => p.at)).toEqual([0, expect.closeTo(0.6)]);
    expect(isEditedClip(kept!)).toBe(true);
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

describe('wordRangeCut', () => {
  it('cuts in the middle of the pauses around the words', () => {
    expect(wordRangeCut(clip(), 1, 1)).toEqual({ from: expect.closeTo(0.65), to: expect.closeTo(1.4) });
  });
  it('reaches the clip edges for the first and last words, in either order', () => {
    expect(wordRangeCut(clip(), 2, 0)).toEqual({ from: 0, to: 3 });
    expect(wordRangeCut(clip({ boundaries: [] }), 0, 0)).toBeNull();
  });
});

describe('edit lists (words deleted inside one clip)', () => {
  const cut = () => deleteClipRange([clip()], 'a', 0.6, 1.4, 'b', never)!.audioItems[0]!;

  it('splits an edited clip into the right file pieces', () => {
    const [l, r] = splitClip(cut(), 1.0, 'b')!;
    expect(l).toMatchObject({ sourceIn: 0, duration: expect.closeTo(1.0) });
    expect(l.pieces).toEqual([{ sourceIn: 0, duration: expect.closeTo(0.6) }, { sourceIn: 1.4, duration: expect.closeTo(0.4) }]);
    expect(r).toMatchObject({ startTime: 11, sourceIn: expect.closeTo(1.8), duration: expect.closeTo(1.2) });
    expect(r.pieces).toBeUndefined();
  });

  it('trims either edge out into the file without touching the inner join', () => {
    const trimmed = trimClipStart(sliceClip(cut(), 0.2, cut().duration)!, 10);
    expect(trimmed.pieces?.[0]).toMatchObject({ sourceIn: expect.closeTo(0), duration: expect.closeTo(0.6) });
    const longer = trimClipEnd({ ...cut(), sourceDuration: 4 }, 13);
    expect(longer.pieces?.[1]).toMatchObject({ sourceIn: 1.4, duration: expect.closeTo(2.4) });
  });

  it('a second delete adds a piece; deleting across a join merges nothing it should not', () => {
    const twice = deleteClipRange([cut()], 'a', 1.0, 1.5, 'b', never)!.audioItems[0]!;
    expect(twice.pieces?.map((p) => [p.sourceIn, p.duration].map((v) => Math.round(v * 100) / 100))).toEqual([[0, 0.6], [1.4, 0.4], [2.3, 0.7]]);
    expect(clipPieces(twice).reduce((n, p) => n + p.duration, 0)).toBeCloseTo(twice.duration);
  });
});

describe('punch-in', () => {
  const later = (over: Partial<AudioTrackItem> = {}): AudioTrackItem => ({ ...clip(), id: 'later', startTime: 15, boundaries: [], ...over });
  const take: AudioTrackItem = { id: 'take', text: 'TWO', audioUrl: 't', startTime: 0, duration: 1.2, boundaries: [{ word: 'TWO', start: 0.1, end: 1.0 }] };

  it('replaces only the marked part and moves later unlinked audio by the length difference', () => {
    const res = punchInClip([clip(), later(), later({ id: 'linked', startTime: 16 })], 'a', 0.6, 1.4, take, 'r', (id) => id === 'linked')!;
    const [left, placed, right, lat, linked] = res.audioItems;
    expect(left).toMatchObject({ id: 'a', startTime: 10, duration: expect.closeTo(0.6) });
    expect(placed).toMatchObject({ id: 'take', startTime: 10.6, duration: 1.2, fadeInMs: 20 });
    expect(right).toMatchObject({ id: 'r', startTime: expect.closeTo(11.8), sourceIn: 1.4, duration: expect.closeTo(1.6) });
    expect(right!.boundaries!.map((w) => w.word)).toEqual(['three']);
    expect(lat!.startTime).toBeCloseTo(15.4);
    expect(linked!.startTime).toBe(16);
    expect(res.ripple).toEqual({ at: 11.4, shift: expect.closeTo(0.4) });
  });

  it('replacing the head keeps the id on the rest; an empty range does nothing', () => {
    const res = punchInClip([clip()], 'a', 0, 1, take, 'r', never)!;
    expect(res.audioItems.map((x) => x.id)).toEqual(['take', 'a']);
    expect(punchInClip([clip()], 'a', 1, 1, take, 'r', never)).toBeNull();
  });

  it('transcribes Hebrew clips in Hebrew', () => {
    expect(clipLanguage(clip({ text: 'שלום עולם' }))).toBe('iw');
    expect(clipLanguage(clip())).toBe('en');
  });
});

describe('guided-transcription fallback words', () => {
  it('stay with the whole recording and are dropped from a piece of it', () => {
    const guided = clip({ scriptMatch: 0.4, whisperBoundaries: [{ word: 'won', start: 0.1, end: 0.5 }] });
    expect(sliceClip(guided, 0, 3)!.whisperBoundaries).toHaveLength(1);
    const piece = sliceClip(guided, 0, 1)!;
    expect(piece.whisperBoundaries).toBeUndefined();
    expect(piece.scriptMatch).toBeUndefined();
  });
});
