import { beforeEach, describe, expect, it } from 'vitest';
import { createTextLine, defaultFrames, defaultSceneDefaults } from '@/store/factories';
import { useSceneStore } from '@/store/useSceneStore';

function reset() {
  const config = defaultFrames();
  useSceneStore.getState().loadSceneDocument(
    { defaults: defaultSceneDefaults(), frames: config.frames, startFrameId: config.startFrameId, items: [], audioItems: undefined },
    42,
  );
  useSceneStore.temporal.getState().clear();
}

const history = () => useSceneStore.temporal.getState();

function addLine(id: string) {
  const line = createTextLine(defaultSceneDefaults());
  line.id = id;
  line.raw = id;
  useSceneStore.getState().addItem(line);
}

describe('undo history records content only', () => {
  beforeEach(reset);

  it('does not record playhead moves, playback or selection', () => {
    useSceneStore.getState().setCurrentTime(3);
    useSceneStore.setState({ isPlaying: true });
    useSceneStore.setState({ isPlaying: false });
    addLine('a');
    useSceneStore.getState().select('a', false);
    useSceneStore.getState().setCurrentTime(7);
    expect(history().pastStates.length).toBe(1);
  });

  it('undoes the last edit after playing and scrubbing, not the playback', () => {
    addLine('a');
    addLine('b');
    useSceneStore.getState().setCurrentTime(5);
    useSceneStore.setState({ isPlaying: true });
    useSceneStore.setState({ isPlaying: false });
    history().undo();
    const s = useSceneStore.getState();
    expect(s.items.has('a')).toBe(true);
    expect(s.items.has('b')).toBe(false);
    expect(s.currentTime).toBe(5); // the playhead stays where the user left it
    history().redo();
    expect(useSceneStore.getState().items.has('b')).toBe(true);
  });

  it('drops a selection that an undo removed', () => {
    addLine('a');
    useSceneStore.getState().select('a', false);
    useSceneStore.getState().inspect('a');
    history().undo();
    const s = useSceneStore.getState();
    expect(s.items.has('a')).toBe(false);
    expect(s.selectedIds.has('a')).toBe(false);
    expect(s.inspectedId).toBeNull();
    expect(history().pastStates.length).toBe(0);
  });

  it('does not record a ruler range request for the time-edit dialog', () => {
    useSceneStore.getState().requestTimelineRange({ from: 1, to: 2 });
    expect(useSceneStore.getState().timelineRangeRequest).toEqual({ from: 1, to: 2 });
    useSceneStore.getState().requestTimelineRange(null);
    expect(history().pastStates.length).toBe(0);
  });
});
