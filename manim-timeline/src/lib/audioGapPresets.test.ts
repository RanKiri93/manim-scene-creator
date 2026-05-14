import { describe, it, expect } from 'vitest';
import type { AudioTrackItem } from '@/types/scene';
import {
  findPreviousAudioEndingBefore,
  computeStartAfterPrevious,
  computeChainedStartsForSortedUnlinked,
} from '@/lib/audioGapPresets';

function track(
  partial: Partial<AudioTrackItem> & Pick<AudioTrackItem, 'id'>,
): AudioTrackItem {
  return {
    text: '',
    audioUrl: '',
    startTime: 0,
    duration: 2,
    ...partial,
  };
}

describe('findPreviousAudioEndingBefore', () => {
  it('picks the track with the latest end still before selection start', () => {
    const items = [
      track({ id: 'a', startTime: 0, duration: 2 }),
      track({ id: 'b', startTime: 1, duration: 2 }),
      track({ id: 'c', startTime: 10, duration: 1 }),
    ];
    expect(findPreviousAudioEndingBefore(items, 'c')?.id).toBe('b');
  });

  it('returns undefined when nothing ends before selection', () => {
    const items = [
      track({ id: 'a', startTime: 0, duration: 5 }),
      track({ id: 'b', startTime: 1, duration: 1 }),
    ];
    expect(findPreviousAudioEndingBefore(items, 'b')).toBeUndefined();
  });
});

describe('computeStartAfterPrevious', () => {
  it('returns previous end + gap', () => {
    const items = [
      track({ id: 'a', startTime: 0, duration: 2 }),
      track({ id: 'b', startTime: 10, duration: 1 }),
    ];
    expect(computeStartAfterPrevious(items, 'b', 0.5)).toBeCloseTo(2.5, 5);
  });

  it('returns null without a previous track', () => {
    const items = [track({ id: 'a', startTime: 0, duration: 2 })];
    expect(computeStartAfterPrevious(items, 'a', 0.5)).toBeNull();
  });
});

describe('computeChainedStartsForSortedUnlinked', () => {
  it('chains starts with gap between end and next start', () => {
    const sorted = [
      track({ id: 'a', startTime: 0, duration: 2 }),
      track({ id: 'b', startTime: 5, duration: 3 }),
      track({ id: 'c', startTime: 20, duration: 1 }),
    ];
    const updates = computeChainedStartsForSortedUnlinked(sorted, 0.4);
    expect(updates[0]).toEqual({ id: 'b', startTime: 2.4 });
    expect(updates[1]!.id).toBe('c');
    expect(updates[1]!.startTime).toBeCloseTo(5.8, 10);
  });

  it('returns empty when fewer than two clips', () => {
    expect(
      computeChainedStartsForSortedUnlinked(
        [track({ id: 'a', startTime: 0, duration: 1 })],
        0.5,
      ),
    ).toEqual([]);
  });
});
