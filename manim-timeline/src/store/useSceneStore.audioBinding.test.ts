import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from '@/store/useSceneStore';
import { AUDIO_BINDING_NONE } from '@/lib/audioBinding';
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
    duration: 4,
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

describe('useSceneStore — explicit audio binding sync', () => {
  beforeEach(() => resetScene());

  it('setItemAudioBinding snaps audio.startTime to visual effectiveStart', () => {
    useSceneStore.setState((s) => {
      s.items.set('l1', minimalLine('l1', 5));
      s.audioItems.push(track({ id: 'a1', startTime: 0, duration: 3 }));
    });

    useSceneStore.getState().setItemAudioBinding('l1', 'a1');
    expect(useSceneStore.getState().audioItems.find((a) => a.id === 'a1')!.startTime).toBe(
      5,
    );
  });

  it('updateItem startTime moves bound audio track', () => {
    useSceneStore.setState((s) => {
      const line = minimalLine('l1', 5);
      line.audioTrackId = 'a1';
      s.items.set('l1', line);
      s.audioItems.push(track({ id: 'a1', startTime: 5, duration: 2 }));
    });

    useSceneStore.getState().updateItem('l1', { startTime: 8 });
    expect(useSceneStore.getState().audioItems.find((a) => a.id === 'a1')!.startTime).toBe(
      8,
    );
  });

  it('one explicit owner per track: binding second clip clears first', () => {
    useSceneStore.setState((s) => {
      s.items.set('l1', { ...minimalLine('l1', 3), audioTrackId: 'a1' });
      s.items.set('l2', { ...minimalLine('l2', 12), audioTrackId: null });
      s.audioItems.push(track({ id: 'a1', startTime: 0, duration: 2 }));
    });

    useSceneStore.getState().setItemAudioBinding('l2', 'a1');
    expect(
      (useSceneStore.getState().items.get('l1') as TextLineItem).audioTrackId,
    ).toBeNull();
    expect(
      (useSceneStore.getState().items.get('l2') as TextLineItem).audioTrackId,
    ).toBe('a1');
    expect(useSceneStore.getState().audioItems.find((a) => a.id === 'a1')!.startTime).toBe(
      12,
    );
  });

  it('AUDIO_BINDING_NONE keeps audio start independent of line moves', () => {
    useSceneStore.setState((s) => {
      const line = minimalLine('l1', 4);
      line.audioTrackId = AUDIO_BINDING_NONE;
      s.items.set('l1', line);
      s.audioItems.push(track({ id: 'a1', startTime: 1, duration: 2 }));
    });

    useSceneStore.getState().updateItem('l1', { startTime: 9 });
    expect(useSceneStore.getState().audioItems.find((a) => a.id === 'a1')!.startTime).toBe(
      1,
    );
  });
});
