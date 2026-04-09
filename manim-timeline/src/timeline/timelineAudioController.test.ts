import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSceneStore } from '@/store/useSceneStore';
import type { AudioTrackItem } from '@/types/scene';
import {
  ensureTimelineAudioSyncWired,
  pickActiveAudioTrackAtTime,
  resetTimelineAudioControllerForTests,
  runTimelineAudioSyncFrameForTests,
  timelineAudioPoolSizeForTests,
} from '@/timeline/timelineAudioController';

class FakeAudio {
  paused = true;
  currentTime = 0;
  src = '';
  dataset = {} as DOMStringMap;
  play = vi.fn(() => {
    this.paused = false;
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  load = vi.fn();
  removeAttribute = vi.fn((name: string) => {
    if (name === 'src') this.src = '';
    if (name === 'data-mt-timeline-key') delete this.dataset.mtTimelineKey;
  });
}

const createdAudios: FakeAudio[] = [];

vi.stubGlobal(
  'document',
  {
    createElement: (tag: string) => {
      if (tag !== 'audio') {
        throw new Error(`unexpected createElement: ${tag}`);
      }
      const el = new FakeAudio();
      createdAudios.push(el);
      return el as unknown as HTMLAudioElement;
    },
  } as Document,
);

const mk = (
  id: string,
  startTime: number,
  duration: number,
  audioUrl: string,
): AudioTrackItem => ({
  id,
  text: '',
  audioUrl,
  startTime,
  duration,
});

describe('pickActiveAudioTrackAtTime', () => {
  it('returns null when nothing is active', () => {
    expect(pickActiveAudioTrackAtTime(5, [mk('a', 0, 1, 'u')])).toBeNull();
  });

  it('returns the only active track', () => {
    const a = mk('a', 0, 10, 'u');
    expect(pickActiveAudioTrackAtTime(3, [a])).toBe(a);
  });

  it('when several overlap, picks earliest startTime then lexicographic id', () => {
    const late = mk('z', 2, 10, 'u2');
    const early = mk('m', 0, 10, 'u1');
    const sameStart = mk('a', 0, 5, 'u0');
    expect(pickActiveAudioTrackAtTime(3, [late, early, sameStart])).toBe(sameStart);
  });
});

describe('timelineAudioController', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    resetTimelineAudioControllerForTests();
    createdAudios.length = 0;
    useSceneStore.setState((s) => {
      s.audioItems = [];
      s.isPlaying = false;
      s.currentTime = 0;
    });
  });

  afterEach(() => {
    resetTimelineAudioControllerForTests();
    createdAudios.length = 0;
  });

  it('uses one shared element and one play() while a single clip is active across many frames', () => {
    useSceneStore.setState((s) => {
      s.audioItems = [mk('a', 0, 10, 'https://example.com/a.mp3')];
      s.currentTime = 0.5;
      s.isPlaying = true;
    });

    for (let i = 0; i < 12; i++) {
      runTimelineAudioSyncFrameForTests();
    }

    expect(createdAudios).toHaveLength(1);
    expect(timelineAudioPoolSizeForTests()).toBe(1);
    expect(createdAudios[0]!.play).toHaveBeenCalledTimes(1);
  });

  it('does not stack playback when two tracks overlap the same time (only one element, one play)', () => {
    useSceneStore.setState((s) => {
      s.audioItems = [
        mk('b', 0, 10, 'https://example.com/b.mp3'),
        mk('a', 0, 10, 'https://example.com/a.mp3'),
      ];
      s.currentTime = 1;
      s.isPlaying = true;
    });

    runTimelineAudioSyncFrameForTests();
    runTimelineAudioSyncFrameForTests();

    expect(createdAudios).toHaveLength(1);
    expect(createdAudios[0]!.play).toHaveBeenCalledTimes(1);
  });

  it('does not add a second element when ensureTimelineAudioSyncWired runs twice', () => {
    ensureTimelineAudioSyncWired();
    ensureTimelineAudioSyncWired();

    useSceneStore.setState((s) => {
      s.audioItems = [mk('a', 0, 10, 'https://example.com/a.mp3')];
      s.currentTime = 1;
      s.isPlaying = true;
    });

    runTimelineAudioSyncFrameForTests();

    expect(createdAudios).toHaveLength(1);
  });

  it('pauses when the playhead leaves the clip window', () => {
    useSceneStore.setState((s) => {
      s.audioItems = [mk('a', 0, 10, 'https://example.com/a.mp3')];
      s.currentTime = 0.5;
      s.isPlaying = true;
    });
    runTimelineAudioSyncFrameForTests();
    const pausesAfterInside = createdAudios[0]!.pause.mock.calls.length;

    useSceneStore.setState((s) => {
      s.currentTime = 11;
    });
    runTimelineAudioSyncFrameForTests();
    expect(createdAudios[0]!.pause.mock.calls.length).toBeGreaterThan(pausesAfterInside);
  });

  it('switches src when crossing into a later clip (same shared element)', () => {
    useSceneStore.setState((s) => {
      s.audioItems = [
        mk('first', 0, 1, 'https://example.com/one.mp3'),
        mk('second', 1, 5, 'https://example.com/two.mp3'),
      ];
      s.currentTime = 0.5;
      s.isPlaying = true;
    });
    runTimelineAudioSyncFrameForTests();
    expect(createdAudios[0]!.src).toContain('one.mp3');

    useSceneStore.setState((s) => {
      s.currentTime = 1.2;
    });
    runTimelineAudioSyncFrameForTests();
    expect(createdAudios[0]!.src).toContain('two.mp3');
    expect(createdAudios).toHaveLength(1);
  });
});
