import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from '@/store/useSceneStore';
import type { AudioTrackItem, TextLineItem } from '@/types/scene';

function minimalLine(id: string, startTime: number): TextLineItem {
  return {
    kind: 'textLine',
    id,
    label: '',
    layer: 0,
    startTime,
    duration: 2,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    audioTrackId: null,
    raw: '',
    font: 'Alef',
    fontSize: 36,
    segments: [],
    measure: null,
    measureError: null,
    previewDataUrl: null,
    segmentMeasures: null,
    mathChildMeasures: null,
  };
}

function track(
  partial: Partial<AudioTrackItem> & Pick<AudioTrackItem, 'id'>,
): AudioTrackItem {
  return {
    text: '',
    audioUrl: '',
    startTime: 0,
    duration: 2,
    ...partial,
    id: partial.id,
  };
}

function resetScene() {
  useSceneStore.setState((s) => {
    s.items.clear();
    s.audioItems = [];
    s.selectedIds.clear();
    s.inspectedId = null;
    s.currentTime = 0;
  });
}

describe('useSceneStore — audio gap presets', () => {
  beforeEach(() => resetScene());

  it('placeAudioAfterPrevious moves unlinked clip after previous end + gap', () => {
    useSceneStore.setState((s) => {
      s.audioItems.push(
        track({ id: 'a1', startTime: 0, duration: 2 }),
        track({ id: 'a2', startTime: 10, duration: 1 }),
      );
    });

    useSceneStore.getState().placeAudioAfterPrevious('a2', 0.5);
    expect(useSceneStore.getState().audioItems.find((a) => a.id === 'a2')!.startTime).toBeCloseTo(
      2.5,
      5,
    );
  });

  it('placeAudioAfterPrevious does not move linked audio', () => {
    useSceneStore.setState((s) => {
      s.items.set('l1', { ...minimalLine('l1', 0), audioTrackId: 'a2' });
      s.audioItems.push(
        track({ id: 'a1', startTime: 0, duration: 2 }),
        track({ id: 'a2', startTime: 10, duration: 1 }),
      );
    });

    useSceneStore.getState().placeAudioAfterPrevious('a2', 0.5);
    expect(useSceneStore.getState().audioItems.find((a) => a.id === 'a2')!.startTime).toBe(10);
  });

  it('spaceSelectedAudioItems chains unlinked selected audio in time order', () => {
    useSceneStore.setState((s) => {
      s.audioItems.push(
        track({ id: 'a1', startTime: 0, duration: 2 }),
        track({ id: 'a2', startTime: 10, duration: 2 }),
        track({ id: 'a3', startTime: 20, duration: 1 }),
      );
      s.selectedIds.add('a1');
      s.selectedIds.add('a3');
      s.selectedIds.add('a2');
    });

    useSceneStore.getState().spaceSelectedAudioItems(0.4);
    const st = useSceneStore.getState().audioItems;
    expect(st.find((a) => a.id === 'a1')!.startTime).toBe(0);
    expect(st.find((a) => a.id === 'a2')!.startTime).toBeCloseTo(2.4, 5);
    expect(st.find((a) => a.id === 'a3')!.startTime).toBeCloseTo(4.8, 5);
  });

  it('spaceSelectedAudioItems skips linked clips and still chains the rest when possible', () => {
    useSceneStore.setState((s) => {
      s.items.set('l1', { ...minimalLine('l1', 0), audioTrackId: 'a2' });
      s.audioItems.push(
        track({ id: 'a1', startTime: 0, duration: 2 }),
        track({ id: 'a2', startTime: 5, duration: 2 }),
        track({ id: 'a3', startTime: 20, duration: 2 }),
      );
      s.selectedIds.add('a1');
      s.selectedIds.add('a2');
      s.selectedIds.add('a3');
    });

    useSceneStore.getState().spaceSelectedAudioItems(1);
    const st = useSceneStore.getState().audioItems;
    expect(st.find((a) => a.id === 'a1')!.startTime).toBe(0);
    expect(st.find((a) => a.id === 'a2')!.startTime).toBe(5);
    expect(st.find((a) => a.id === 'a3')!.startTime).toBeCloseTo(3, 5);
  });
});
