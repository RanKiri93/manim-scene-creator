import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from '@/store/useSceneStore';
import type { AudioTrackItem } from '@/types/scene';
import { buildAudioMixdownSpec, needsAudioMixdown } from '@/lib/audioMixdown';
import {
  copyAudioSelection,
  cutAudioSelection,
  pasteAudioClipboard,
  useAudioEditSession,
} from '@/timeline/audioEditSession';

const track = (id: string, startTime: number, duration = 2, extra: Partial<AudioTrackItem> = {}): AudioTrackItem => ({
  id,
  text: '',
  audioUrl: `blob:${id}`,
  assetRelPath: `assets/audio/${id}.wav`,
  startTime,
  duration,
  ...extra,
});

const history = () => useSceneStore.temporal.getState();

describe('narration edits in the store', () => {
  beforeEach(() => {
    useSceneStore.setState((s) => {
      s.items = new Map();
      s.audioItems = [track('a', 0, 4), track('b', 5)];
      s.selectedIds = new Set();
      s.currentTime = 1.5;
    });
    history().clear();
    useAudioEditSession.setState({ range: null, clipboard: [] });
  });

  it('S splits the clip under the playhead, in one undo step', () => {
    expect(useSceneStore.getState().splitAudioAt(1.5)).toBe(1);
    const items = useSceneStore.getState().audioItems;
    expect(items.map((a) => [a.id === 'a' ? 'a' : a.id === 'b' ? 'b' : 'new', a.startTime, a.duration])).toEqual([
      ['a', 0, 1.5],
      ['new', 1.5, 2.5],
      ['b', 5, 2],
    ]);
    history().undo();
    expect(useSceneStore.getState().audioItems).toHaveLength(2);
  });

  it('splits only selected clips when audio is selected', () => {
    useSceneStore.setState((s) => {
      s.audioItems.push(track('c', 1, 2));
      s.selectedIds = new Set(['c']);
    });
    expect(useSceneStore.getState().splitAudioAt(1.5)).toBe(1);
    expect(useSceneStore.getState().audioItems.find((a) => a.id === 'a')!.duration).toBe(4);
  });

  it('a live trim drag becomes one undo step', () => {
    const before = useSceneStore.getState().audioItems;
    const base = before[0]!;
    history().pause();
    for (const t of [0.5, 1, 1.25]) useSceneStore.getState().trimAudioClip('a', 'start', t, base);
    useSceneStore.getState().commitAudioDrag(before);
    expect(useSceneStore.getState().audioItems[0]).toMatchObject({ startTime: 1.25, sourceIn: 1.25, duration: 2.75 });
    expect(history().pastStates).toHaveLength(1);
    history().undo();
    expect(useSceneStore.getState().audioItems[0]).toEqual(base);
  });

  it('deleting a range closes the clip and pulls later audio left', () => {
    expect(useSceneStore.getState().deleteAudioRange('a', 1, 2)).toBe(true);
    const items = useSceneStore.getState().audioItems;
    expect(items.map((a) => [a.startTime, a.duration, a.sourceIn ?? 0])).toEqual([
      [0, 1, 0],
      [1, 2, 2],
      [4, 2, 0],
    ]);
  });

  it('cut a range, paste on top keeps the rest in place; insert pushes', () => {
    useAudioEditSession.setState({ range: { clipId: 'a', from: 1, to: 2 } });
    expect(cutAudioSelection()).toBe(true);
    useSceneStore.setState((s) => {
      s.currentTime = 8;
    });
    expect(pasteAudioClipboard('over')).toBe(true);
    let items = useSceneStore.getState().audioItems;
    expect(items.at(-1)).toMatchObject({ startTime: 8, sourceIn: 1, duration: 1, audioUrl: 'blob:a' });
    expect(items.find((a) => a.id === 'b')!.startTime).toBe(4);

    useSceneStore.setState((s) => {
      s.currentTime = 0.5;
    });
    expect(pasteAudioClipboard('insert')).toBe(true);
    items = useSceneStore.getState().audioItems;
    expect(items.find((a) => a.id === 'b')!.startTime).toBe(5);
    expect(useSceneStore.getState().selectedIds.size).toBe(1);
  });

  it('copies selected whole clips relative to the earliest', () => {
    useSceneStore.setState((s) => {
      s.selectedIds = new Set(['a', 'b']);
    });
    expect(copyAudioSelection()).toBe(true);
    expect(useAudioEditSession.getState().clipboard.map((c) => c.startTime)).toEqual([0, 5]);
  });

  it('removing one split piece keeps the shared blob URL usable', () => {
    useSceneStore.getState().splitAudioAt(1.5);
    const right = useSceneStore.getState().audioItems[1]!;
    useSceneStore.getState().removeAudioItem(right.id);
    history().undo();
    expect(useSceneStore.getState().audioItems[1]!.audioUrl).toBe('blob:a');
  });
});

describe('mixdown spec for edited clips', () => {
  it('sends slice and gain only for edited clips and forces the mixdown', () => {
    const plain = track('p', 0, 2);
    const piece = track('q', 3, 1, { sourceIn: 0.5, sourceDuration: 2, gainDb: -3 });
    const defaults = { ...useSceneStore.getState().defaults, audioCutFadeMs: 0 };
    expect(needsAudioMixdown(null, [plain], defaults)).toBe(false);
    expect(needsAudioMixdown(null, [plain, piece], defaults)).toBe(true);
    const spec = buildAudioMixdownSpec([], [plain, piece], defaults, {});
    expect(spec.clips[0]).not.toHaveProperty('source_in_sec');
    expect(spec.clips[1]).toMatchObject({ source_in_sec: 0.5, duration_sec: 1, gain_db: -3, start_sec: 3 });
  });
});
