import { describe, expect, it } from 'vitest';
import type { AudioTake, AudioTrackItem } from '@/types/scene';
import { addTake, removeTake, swapToTake } from './audioTakes';
import { sliceClip } from './audioEdit';

const clip: AudioTrackItem = {
  id: 'a', text: 'hello there', audioUrl: 'u1', assetRelPath: 'assets/audio/u1.wav', startTime: 2, duration: 3,
  gainDb: -2, fadeInMs: 30, sourceIn: 0.5, boundaries: [{ word: 'hello', start: 0, end: 1 }],
};
const later: AudioTrackItem = { id: 'l', text: '', audioUrl: 'u3', startTime: 6, duration: 1 };
const linkedLater: AudioTrackItem = { ...later, id: 'linked', startTime: 8 };
const take: AudioTake = { id: 't2', text: 'hello there', audioUrl: 'u2', duration: 2, boundaries: [{ word: 'hello', start: 0.1, end: 0.9 }] };
const isLinked = (id: string) => id === 'linked';

describe('takes', () => {
  it('a new take is used right away and the old sound is kept; settings and place stay', () => {
    const res = addTake([clip, later, linkedLater], 'a', take, isLinked)!;
    const [a, l, linked] = res.audioItems;
    expect(a).toMatchObject({ id: 'a', startTime: 2, duration: 2, audioUrl: 'u2', gainDb: -2, fadeInMs: 30 });
    expect(a!.sourceIn).toBeUndefined();
    expect(a!.assetRelPath).toBeUndefined();
    expect(a!.takes).toHaveLength(1);
    expect(a!.takes![0]).toMatchObject({ audioUrl: 'u1', assetRelPath: 'assets/audio/u1.wav', duration: 3, sourceIn: 0.5 });
    expect(l!.startTime).toBe(5);
    expect(linked!.startTime).toBe(8);
    expect(res.ripple).toEqual({ at: 5, shift: -1 });
  });

  it('switching back restores the first take; removing forgets one', () => {
    const withTake = addTake([clip], 'a', take, isLinked)!.audioItems;
    const oldId = withTake[0]!.takes![0]!.id;
    const back = swapToTake(withTake, 'a', oldId, isLinked)!.audioItems[0]!;
    expect(back).toMatchObject({ audioUrl: 'u1', duration: 3, sourceIn: 0.5, assetRelPath: 'assets/audio/u1.wav' });
    expect(back.takes!.map((t) => t.audioUrl)).toEqual(['u2']);
    const removed = removeTake([back], 'a', back.takes![0]!.id)![0]!;
    expect(removed.takes).toBeUndefined();
    expect(swapToTake([clip], 'a', 'missing', isLinked)).toBeNull();
  });

  it('a split-off piece does not carry the other takes', () => {
    const withTake = addTake([clip], 'a', take, isLinked)!.audioItems[0]!;
    expect(sliceClip(withTake, 0, 1)!.takes).toHaveLength(1);
    expect(sliceClip(withTake, 1, 2, 'b')!.takes).toBeUndefined();
  });
});
