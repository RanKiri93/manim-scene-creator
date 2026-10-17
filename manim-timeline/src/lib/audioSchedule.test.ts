import { describe, expect, it } from 'vitest';
import type { AudioTrackItem, SceneDefaults } from '@/types/scene';
import {
  audioBedPlay,
  audioPlaySegments,
  fadeEnvelopeAt,
  fadeRampPoints,
  scheduleFrom,
} from './audioSchedule';

const defaults = { audioCutFadeMs: 40 } as SceneDefaults;
const mk = (id: string, startTime: number, duration: number, extra: Partial<AudioTrackItem> = {}): AudioTrackItem => ({
  id,
  text: '',
  audioUrl: `u:${id}`,
  startTime,
  duration,
  ...extra,
});

describe('audioPlaySegments', () => {
  it('uses clip fades, the scene default, file offset and gain', () => {
    const [a, b] = audioPlaySegments(
      [mk('a', 1, 2, { fadeInMs: 100 }), mk('b', 4, 1, { sourceIn: 2.5, gainDb: -6 })],
      defaults,
    );
    expect(a).toMatchObject({ timelineStart: 1, sourceIn: 0, fadeIn: 0.1, fadeOut: 0.04, gain: 1 });
    expect(b!.sourceIn).toBe(2.5);
    expect(b!.gain).toBeCloseTo(0.501, 3);
  });

  it('shrinks fades that do not fit the clip and skips empty clips', () => {
    const segs = audioPlaySegments(
      [mk('a', 0, 0.1, { fadeInMs: 100, fadeOutMs: 100 }), mk('none', 0, 0), mk('nourl', 0, 1, { audioUrl: '' })],
      defaults,
    );
    expect(segs).toHaveLength(1);
    expect(segs[0]!.fadeIn).toBeCloseTo(0.05);
    expect(segs[0]!.fadeOut).toBeCloseTo(0.05);
  });

  it('bed gain from dB', () => {
    expect(audioBedPlay({ audioUrl: 'x', gainDb: -20, kind: 'music' })!.gain).toBeCloseTo(0.1);
    expect(audioBedPlay(null)).toBeNull();
  });
});

describe('scheduleFrom', () => {
  const segs = audioPlaySegments([mk('a', 0, 4), mk('b', 2, 4), mk('c', 10, 1)], { audioCutFadeMs: 0 } as SceneDefaults);

  it('skips finished clips, starts inside the current one and delays later ones', () => {
    const plays = scheduleFrom(segs, 3);
    expect(plays.map((p) => [p.seg.id, p.delay, p.clipOffset, p.length])).toEqual([
      ['a', 0, 3, 1],
      ['b', 0, 1, 3],
      ['c', 7, 0, 1],
    ]);
    expect(scheduleFrom(segs, 11)).toEqual([]);
  });
});

describe('fade envelope', () => {
  const [seg] = audioPlaySegments([mk('a', 0, 1, { fadeInMs: 200, fadeOutMs: 100 })], defaults);

  it('is linear in, flat, linear out', () => {
    expect(fadeEnvelopeAt(seg!, 0.1)).toBeCloseTo(0.5);
    expect(fadeEnvelopeAt(seg!, 0.5)).toBe(1);
    expect(fadeEnvelopeAt(seg!, 0.95)).toBeCloseTo(0.5);
  });

  it('ramp points from the start and from inside the fade-in', () => {
    expect(fadeRampPoints(scheduleFrom([seg!], 0)[0]!)).toEqual([
      [0, expect.closeTo(0, 6)],
      [expect.closeTo(0.2, 6), 1],
      [expect.closeTo(0.9, 6), 1],
      [1, 0],
    ]);
    const mid = fadeRampPoints(scheduleFrom([seg!], 0.1)[0]!);
    expect(mid[0]![1]).toBeCloseTo(0.5);
    expect(mid[1]![0]).toBeCloseTo(0.1);
  });

  it('no fades: full level throughout', () => {
    const [plain] = audioPlaySegments([mk('p', 0, 1)], { audioCutFadeMs: 0 } as SceneDefaults);
    expect(fadeRampPoints(scheduleFrom([plain!], 0)[0]!)).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });
});
