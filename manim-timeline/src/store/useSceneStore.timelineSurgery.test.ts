import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from '@/store/useSceneStore';
import { holdEnd } from '@/lib/time';
import type {
  AudioTrackItem,
  AxesItem,
  ExitAnimationItem,
  TextLineItem,
} from '@/types/scene';

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

function minimalAxes(id: string, startTime: number): AxesItem {
  return {
    kind: 'axes',
    id,
    label: '',
    layer: 1,
    startTime,
    duration: 3,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    xRange: [0, 10, 1],
    yRange: [0, 10, 1],
    xLabel: '',
    yLabel: '',
    includeNumbers: false,
    includeTip: true,
    scaleX: 1,
    scaleY: 1,
  };
}

function exitFor(id: string, targetId: string, startTime: number): ExitAnimationItem {
  return {
    kind: 'exit_animation',
    id,
    label: '',
    layer: 0,
    startTime,
    duration: 1,
    targets: [{ targetId, animStyle: 'fade_out' }],
  };
}

function track(
  partial: Partial<AudioTrackItem> & Pick<AudioTrackItem, 'id'>,
): AudioTrackItem {
  return {
    text: '',
    audioUrl: 'https://example.com/a.mp3',
    assetRelPath: 'assets/audio/a.mp3',
    boundaries: [{ word: 'hi', start: 0.1, end: 0.4 }],
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

function startOf(id: string): number {
  return (useSceneStore.getState().items.get(id) as TextLineItem).startTime;
}

function audioStartOf(id: string): number {
  return useSceneStore.getState().audioItems.find((a) => a.id === id)!.startTime;
}

describe('useSceneStore timeline surgery', () => {
  beforeEach(() => resetScene());

  it('close range shifts text/axes/effect clips and unlinked audio left', () => {
    useSceneStore.setState((s) => {
      s.items.set('l1', minimalLine('l1', 0));
      s.items.set('ax', minimalAxes('ax', 6));
      s.items.set('ex', exitFor('ex', 'l1', 8));
      s.audioItems.push(track({ id: 'a1', startTime: 7, duration: 2 }));
    });

    expect(useSceneStore.getState().closeTimelineRange(2, 5)).toBe(true);
    const st = useSceneStore.getState();
    expect((st.items.get('l1') as TextLineItem).startTime).toBe(0);
    expect((st.items.get('ax') as AxesItem).startTime).toBe(3);
    expect((st.items.get('ex') as ExitAnimationItem).startTime).toBe(5);
    expect(audioStartOf('a1')).toBe(4);
    // Effect clip still starts at/after its target hold end.
    const l1 = st.items.get('l1')!;
    expect((st.items.get('ex') as ExitAnimationItem).startTime).toBeGreaterThanOrEqual(
      holdEnd(l1, st.items),
    );
  });

  it('insert empty time shifts later clips and unlinked audio right', () => {
    useSceneStore.setState((s) => {
      s.items.set('l1', minimalLine('l1', 0));
      s.items.set('ax', minimalAxes('ax', 6));
      s.audioItems.push(track({ id: 'a1', startTime: 6, duration: 1 }));
    });

    expect(useSceneStore.getState().insertEmptyTimelineTime(4, 2.5)).toBe(true);
    expect(startOf('l1')).toBe(0);
    expect((useSceneStore.getState().items.get('ax') as AxesItem).startTime).toBeCloseTo(
      8.5,
      9,
    );
    expect(audioStartOf('a1')).toBeCloseTo(8.5, 9);
  });

  it('linked audio follows its shifted visual owner exactly once', () => {
    useSceneStore.setState((s) => {
      s.items.set('l1', { ...minimalLine('l1', 10), audioTrackId: 'a1' });
      s.audioItems.push(track({ id: 'a1', startTime: 10, duration: 2 }));
    });

    expect(useSceneStore.getState().closeTimelineRange(0, 4)).toBe(true);
    expect(startOf('l1')).toBe(6);
    expect(audioStartOf('a1')).toBe(6);
  });

  it('linked audio whose owner stays put does not move', () => {
    useSceneStore.setState((s) => {
      s.items.set('l1', { ...minimalLine('l1', 0), audioTrackId: 'a1' });
      s.items.set('l2', minimalLine('l2', 10));
      s.audioItems.push(track({ id: 'a1', startTime: 0, duration: 2 }));
    });

    expect(useSceneStore.getState().closeTimelineRange(4, 7)).toBe(true);
    expect(startOf('l1')).toBe(0);
    expect(audioStartOf('a1')).toBe(0);
    expect(startOf('l2')).toBe(7);
  });

  it('word boundaries and audio metadata survive a move', () => {
    useSceneStore.setState((s) => {
      s.audioItems.push(
        track({ id: 'a1', startTime: 8, duration: 2, text: 'hello' }),
      );
    });

    expect(useSceneStore.getState().closeTimelineRange(0, 3)).toBe(true);
    const a = useSceneStore.getState().audioItems.find((x) => x.id === 'a1')!;
    expect(a.startTime).toBe(5);
    expect(a.boundaries).toEqual([{ word: 'hi', start: 0.1, end: 0.4 }]);
    expect(a.audioUrl).toBe('https://example.com/a.mp3');
    expect(a.assetRelPath).toBe('assets/audio/a.mp3');
    expect(a.duration).toBe(2);
    expect(a.text).toBe('hello');
  });

  it('invalid or blocked edits are no-ops', () => {
    useSceneStore.setState((s) => {
      s.items.set('l1', minimalLine('l1', 4));
      s.audioItems.push(track({ id: 'a1', startTime: 12, duration: 1 }));
      s.currentTime = 9;
    });

    // Invalid ranges.
    expect(useSceneStore.getState().closeTimelineRange(5, 5)).toBe(false);
    expect(useSceneStore.getState().insertEmptyTimelineTime(2, 0)).toBe(false);
    // Blocked: line spans the range / insertion point.
    expect(useSceneStore.getState().closeTimelineRange(5, 7)).toBe(false);
    expect(useSceneStore.getState().insertEmptyTimelineTime(5, 2)).toBe(false);
    // Blocked: audio spans the range.
    expect(useSceneStore.getState().closeTimelineRange(12, 14)).toBe(false);

    expect(startOf('l1')).toBe(4);
    expect(audioStartOf('a1')).toBe(12);
    expect(useSceneStore.getState().currentTime).toBe(9);
  });

  it('maps currentTime through close and insert edits', () => {
    useSceneStore.setState((s) => {
      s.items.set('l1', minimalLine('l1', 10));
    });

    // Playhead inside the removed range lands on its start.
    useSceneStore.setState((s) => {
      s.currentTime = 5;
    });
    expect(useSceneStore.getState().closeTimelineRange(3, 7)).toBe(true);
    expect(useSceneStore.getState().currentTime).toBe(3);

    // Playhead after the range shifts left with the timeline.
    useSceneStore.setState((s) => {
      s.currentTime = 12;
    });
    // l1 is now at 6..8; closing [0, 2) is empty.
    expect(useSceneStore.getState().closeTimelineRange(0, 2)).toBe(true);
    expect(useSceneStore.getState().currentTime).toBe(10);
    expect(startOf('l1')).toBe(4);

    // Insert: playhead after the point shifts right; at the point it stays.
    useSceneStore.setState((s) => {
      s.currentTime = 9;
    });
    expect(useSceneStore.getState().insertEmptyTimelineTime(2, 3)).toBe(true);
    expect(useSceneStore.getState().currentTime).toBe(12);

    useSceneStore.setState((s) => {
      s.currentTime = 2;
    });
    expect(useSceneStore.getState().insertEmptyTimelineTime(2, 3)).toBe(true);
    expect(useSceneStore.getState().currentTime).toBe(2);
  });
});
