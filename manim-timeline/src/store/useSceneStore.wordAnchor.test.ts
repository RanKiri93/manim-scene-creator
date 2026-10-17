import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from '@/store/useSceneStore';
import { createTextLine, defaultSceneDefaults } from '@/store/factories';
import type { AudioTrackItem } from '@/types/scene';

const voice = (): AudioTrackItem => ({
  id: 'v',
  text: '',
  audioUrl: 'blob:v',
  startTime: 2,
  duration: 4,
  boundaries: [
    { word: 'one', start: 0.2, end: 0.6 },
    { word: 'two', start: 1.2, end: 1.6 },
    { word: 'three', start: 2.2, end: 2.6 },
  ],
});

function setup() {
  const line = createTextLine(defaultSceneDefaults(), 0);
  line.id = 'L';
  line.startTime = 4.2; // on "three"
  line.audioTrackId = null;
  useSceneStore.setState((s) => {
    s.items = new Map([['L', line]]);
    s.audioItems = [voice()];
    s.selectedIds = new Set();
  });
  useSceneStore.getState().setWordAnchor('L', { trackId: 'v', wordIndex: 2 });
}

const lineStart = () => useSceneStore.getState().items.get('L')!.startTime;

describe('word anchors', () => {
  beforeEach(setup);

  it('anchoring gives the words ids and records the word', () => {
    const words = useSceneStore.getState().audioItems[0]!.boundaries!;
    expect(words.every((w) => w.id)).toBe(true);
    expect(useSceneStore.getState().items.get('L')!.wordAnchor).toEqual({ wordId: words[2]!.id });
  });

  it('follows when the narration moves', () => {
    useSceneStore.getState().moveAudioItem('v', 3);
    expect(lineStart()).toBeCloseTo(5.2);
  });

  it('follows when audio before the word is cut out', () => {
    useSceneStore.getState().deleteAudioRange('v', 0.8, 1.8); // removes "two"
    expect(lineStart()).toBeCloseTo(3.2);
    const right = useSceneStore.getState().audioItems[1]!;
    expect(right.boundaries!.map((w) => w.word)).toEqual(['three']);
  });

  it('follows when a word start is nudged and when audio is inserted before it', () => {
    useSceneStore.getState().updateAudioBoundary('v', 2, { start: 2.3 });
    expect(lineStart()).toBeCloseTo(4.3);
    useSceneStore.getState().pasteAudioClips(
      [{ id: 'p', text: '', audioUrl: 'blob:p', startTime: 0, duration: 0.5 }],
      2.1,
      'insert',
    );
    expect(lineStart()).toBeCloseTo(4.8);
  });

  it('does not follow a pasted copy of the word, nor move twice in a time insert', () => {
    useSceneStore.getState().pasteAudioClips(useSceneStore.getState().audioItems, 20, 'over');
    expect(lineStart()).toBeCloseTo(4.2);
    useSceneStore.getState().insertEmptyTimelineTime(1, 1);
    expect(lineStart()).toBeCloseTo(5.2);
  });

  it('a clip that owns the narration cannot anchor to it; null clears', () => {
    useSceneStore.getState().setWordAnchor('L', null);
    useSceneStore.setState((s) => {
      (s.items.get('L') as { audioTrackId?: string | null }).audioTrackId = 'v';
    });
    useSceneStore.getState().setWordAnchor('L', { trackId: 'v', wordIndex: 0 });
    expect(useSceneStore.getState().items.get('L')!.wordAnchor).toBeUndefined();
  });
});
