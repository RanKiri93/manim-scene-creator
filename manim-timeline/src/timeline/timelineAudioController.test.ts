import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSceneStore } from '@/store/useSceneStore';
import type { AudioTrackItem } from '@/types/scene';
import {
  ensureTimelineAudioSyncWired,
  resetTimelineAudioControllerForTests,
  runTimelineAudioSyncFrameForTests,
  timelineAudioSessionForTests,
} from '@/timeline/timelineAudioController';
import { setAudioBuffersForTests } from '@/timeline/audioBuffers';

type Call = [string, ...number[]];

class FakeSource {
  buffer: { duration: number; url: string } | null = null;
  loop = false;
  started: number[] | null = null;
  stopped = false;
  connect(n: FakeGain) {
    return n;
  }
  disconnect() {}
  start(...args: number[]) {
    this.started = args;
  }
  stop() {
    this.stopped = true;
  }
}

class FakeGain {
  calls: Call[] = [];
  gain = {
    setValueAtTime: (v: number, t: number) => this.calls.push(['set', v, t]),
    linearRampToValueAtTime: (v: number, t: number) => this.calls.push(['ramp', v, t]),
  };
  connect(n: unknown) {
    return n;
  }
  disconnect() {}
}

class FakeCtx {
  currentTime = 10;
  state = 'running';
  destination = {};
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  resume = vi.fn(() => Promise.resolve());
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
}

const mk = (
  id: string,
  startTime: number,
  duration: number,
  extra: Partial<AudioTrackItem> = {},
): AudioTrackItem => ({ id, text: '', audioUrl: `u:${id}`, startTime, duration, ...extra });

let ctx: FakeCtx;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('timelineAudioController (Web Audio)', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    resetTimelineAudioControllerForTests();
    ctx = new FakeCtx();
    setAudioBuffersForTests({
      ctx: ctx as unknown as AudioContext,
      loader: async (url) =>
        ({
          url,
          duration: 30,
          numberOfChannels: 0,
          sampleRate: 48000,
          getChannelData: () => new Float32Array(),
        }) as unknown as AudioBuffer,
    });
    useSceneStore.setState((s) => {
      s.audioItems = [];
      s.audioBed = null;
      s.isPlaying = false;
      s.currentTime = 0;
      s.defaults.audioCutFadeMs = 0;
    });
  });

  afterEach(() => {
    resetTimelineAudioControllerForTests();
    setAudioBuffersForTests({ ctx: null });
  });

  it('schedules every clip still ahead, overlapping ones included, on the audio clock', async () => {
    useSceneStore.setState((s) => {
      s.audioItems = [mk('a', 0, 4), mk('b', 2, 4), mk('past', 0, 0.5)];
      s.currentTime = 1;
      s.isPlaying = true;
    });
    runTimelineAudioSyncFrameForTests();
    await flush();

    expect(ctx.sources).toHaveLength(2);
    const t0 = 10 + 0.03; // ctx.currentTime + lead
    const [a, b] = ctx.sources;
    expect(a!.buffer!.url).toBe('u:a');
    expect(a!.started).toEqual([expect.closeTo(t0, 6), expect.closeTo(1, 6), expect.closeTo(3, 6)]); // starts 1 s into the file
    expect(b!.started).toEqual([expect.closeTo(t0 + 1, 6), 0, expect.closeTo(4, 6)]);
  });

  it('plays only the piece of the file a trimmed clip points at, with its gain', async () => {
    useSceneStore.setState((s) => {
      s.audioItems = [mk('a', 5, 2, { sourceIn: 3, gainDb: -6 })];
      s.currentTime = 4;
      s.isPlaying = true;
    });
    runTimelineAudioSyncFrameForTests();
    await flush();

    const src = ctx.sources[0]!;
    expect(src.started![1]).toBe(3);
    expect(src.started![2]).toBe(2);
    const set = ctx.gains[0]!.calls[0]!;
    expect(set[0]).toBe('set');
    expect(set[1]).toBeCloseTo(0.501, 3);
  });

  it('ramps the cut fades', async () => {
    useSceneStore.setState((s) => {
      s.defaults.audioCutFadeMs = 100;
      s.audioItems = [mk('a', 1, 2)];
      s.currentTime = 0;
      s.isPlaying = true;
    });
    runTimelineAudioSyncFrameForTests();
    await flush();

    const start = ctx.sources[0]!.started![0]!;
    expect(ctx.gains[0]!.calls).toEqual([
      ['set', expect.closeTo(0, 6), start],
      ['ramp', 1, expect.closeTo(start + 0.1, 6)],
      ['ramp', 1, expect.closeTo(start + 1.9, 6)],
      ['ramp', 0, expect.closeTo(start + 2, 6)],
    ]);
  });

  it('loops the bed from its scene-time position', async () => {
    useSceneStore.setState((s) => {
      s.audioBed = { audioUrl: 'u:bed', gainDb: -20, kind: 'music' };
      s.currentTime = 65;
      s.isPlaying = true;
    });
    runTimelineAudioSyncFrameForTests();
    await flush();

    const bed = ctx.sources[0]!;
    expect(bed.loop).toBe(true);
    expect(bed.started![1]).toBeCloseTo(65 % 30, 6);
    expect(ctx.gains[0]!.calls[0]![1]).toBeCloseTo(0.1, 6);
  });

  it('keeps the session while the playhead follows the clock and restarts on a seek', async () => {
    useSceneStore.setState((s) => {
      s.audioItems = [mk('a', 0, 10)];
      s.currentTime = 1;
      s.isPlaying = true;
    });
    runTimelineAudioSyncFrameForTests();
    const first = timelineAudioSessionForTests();

    ctx.currentTime += 0.5;
    useSceneStore.setState((s) => {
      s.currentTime = 1.5;
    });
    runTimelineAudioSyncFrameForTests();
    expect(timelineAudioSessionForTests()).toBe(first);

    useSceneStore.setState((s) => {
      s.currentTime = 6;
    });
    runTimelineAudioSyncFrameForTests();
    await flush();
    expect(timelineAudioSessionForTests()).not.toBe(first);
    expect(timelineAudioSessionForTests()!.sceneT0).toBe(6);
  });

  it('restarts when the audio is edited during playback and stops everything on pause', async () => {
    ensureTimelineAudioSyncWired();
    useSceneStore.setState((s) => {
      s.audioItems = [mk('a', 0, 10)];
      s.currentTime = 1;
      s.isPlaying = true;
    });
    runTimelineAudioSyncFrameForTests();
    await flush();
    const first = timelineAudioSessionForTests();

    useSceneStore.setState((s) => {
      s.audioItems = [mk('a', 0.5, 10)];
    });
    runTimelineAudioSyncFrameForTests();
    await flush();
    expect(timelineAudioSessionForTests()).not.toBe(first);
    expect(ctx.sources[0]!.stopped).toBe(true);

    useSceneStore.setState((s) => {
      s.isPlaying = false;
    });
    expect(timelineAudioSessionForTests()).toBeNull();
    expect(ctx.sources.every((src) => src.stopped)).toBe(true);
  });
});
