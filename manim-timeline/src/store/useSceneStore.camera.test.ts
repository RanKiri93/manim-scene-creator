import { beforeEach, describe, expect, it } from 'vitest';
import { FRAME_W } from '@/lib/constants';
import { cameraPoseAtTime, resolveCameraSchedule, validateCameraMove } from '@/lib/camera';
import { createCameraMove, createFrame, createShape, defaultFrames, defaultSceneDefaults } from '@/store/factories';
import { useSceneStore } from '@/store/useSceneStore';
import type { CameraMoveItem, ProjectFragmentFile, SceneItem } from '@/types/scene';

function resetScene() {
  const config = defaultFrames();
  config.frames.push(createFrame(1, 0, 'Right'));
  useSceneStore.getState().loadSceneDocument(
    {
      defaults: defaultSceneDefaults(),
      frames: config.frames,
      startFrameId: config.startFrameId,
      items: [],
      audioItems: undefined,
    },
    42,
  );
  useSceneStore.getState().setCameraObjectFitPadding(0.3);
  useSceneStore.temporal.getState().clear();
}

function camera(id: string, targetFrameId: string, startTime: number, duration: number, width = FRAME_W): CameraMoveItem {
  const item = createCameraMove(targetFrameId, startTime, duration);
  item.id = id;
  item.targetWidth = width;
  return item;
}

describe('camera clip authoring', () => {
  beforeEach(resetScene);

  it('shares a default 0.3 object-fit padding and clamps it down to zero', () => {
    expect(useSceneStore.getState().cameraObjectFitPadding).toBe(0.3);
    useSceneStore.getState().setCameraObjectFitPadding(0.15);
    expect(useSceneStore.getState().cameraObjectFitPadding).toBe(0.15);
    useSceneStore.getState().setCameraObjectFitPadding(-1);
    expect(useSceneStore.getState().cameraObjectFitPadding).toBe(0);
    useSceneStore.getState().setCameraObjectFitPadding(Number.NaN);
    expect(useSceneStore.getState().cameraObjectFitPadding).toBe(0.3);
  });

  it('inserts and selects in one store transaction and one undo checkpoint', () => {
    const frameId = useSceneStore.getState().startFrameId;
    const clip = camera('new', frameId, 0, 1);
    useSceneStore.getState().addCameraMoveClip(clip);
    const state = useSceneStore.getState();
    expect(state.items.get('new')).toEqual(clip);
    expect(state.selectedIds).toEqual(new Set(['new']));
    expect(state.inspectedId).toBe('new');
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(1);
    useSceneStore.temporal.getState().undo();
    expect(useSceneStore.getState().items.has('new')).toBe(false);
    useSceneStore.temporal.getState().redo();
    expect(useSceneStore.getState().items.get('new')).toEqual(clip);
  });

  it('accepts overlaps and never trims or retimes an independent return', () => {
    const state = useSceneStore.getState();
    const frameId = state.startFrameId;
    const a = camera('a', frameId, 0, 10, 4);
    const b = camera('b', frameId, 2, 1, 8);
    const returnMove = camera('return', frameId, 9, 1, FRAME_W);
    state.addItem(a);
    state.addCameraMoveClip(b);
    useSceneStore.getState().addCameraMoveClip(returnMove);
    useSceneStore.getState().moveItem('b', 3);
    useSceneStore.getState().resizeItem('b', 2);
    useSceneStore.getState().updateItem('b', { targetWidth: 6 });
    const st = useSceneStore.getState();
    expect((st.items.get('a') as CameraMoveItem)).toMatchObject({ startTime: 0, duration: 10, targetWidth: 4 });
    expect((st.items.get('b') as CameraMoveItem)).toMatchObject({ startTime: 3, duration: 2, targetWidth: 6 });
    expect((st.items.get('return') as CameraMoveItem)).toMatchObject({ id: 'return', startTime: 9, duration: 1, targetWidth: FRAME_W });
  });

  it('recomputes earlier control when the winner is deleted and undo restores it', () => {
    const state = useSceneStore.getState();
    const a = camera('a', state.startFrameId, 0, 4, 4);
    const b = camera('b', state.startFrameId, 2, 1, 8);
    state.addItem(a);
    useSceneStore.getState().addCameraMoveClip(b);
    expect(cameraPoseWidth(3)).toBeCloseTo(8);
    useSceneStore.getState().removeItem('b');
    expect(cameraPoseWidth(5)).toBeCloseTo(4);
    useSceneStore.temporal.getState().undo();
    expect(cameraPoseWidth(3)).toBeCloseTo(8);
  });

  it('round-trips camera width, target, time, and an explicit return through JSON', () => {
    const state = useSceneStore.getState();
    const zoom = camera('zoom', state.startFrameId, 5, 1, 3.5);
    const returnMove = camera('return', state.startFrameId, 9, 1, FRAME_W);
    state.addItem(zoom);
    useSceneStore.getState().addCameraMoveClip(returnMove);
    const disk = useSceneStore.getState().toProjectFile();
    const reloaded = JSON.parse(JSON.stringify(disk)) as typeof disk;
    useSceneStore.getState().loadProjectFile(reloaded);
    expect(useSceneStore.getState().items.get('zoom')).toMatchObject({ targetWidth: 3.5, startTime: 5, duration: 1 });
    expect(useSceneStore.getState().items.get('return')).toMatchObject({ targetWidth: FRAME_W, startTime: 9, duration: 1 });
  });

  it('keeps a snapshot destination after the source object is deleted', () => {
    const state = useSceneStore.getState();
    const shape = createShape(0);
    const zoom = camera('zoom', state.startFrameId, 2, 1, 4);
    state.addItem(shape);
    useSceneStore.getState().addCameraMoveClip(zoom);
    useSceneStore.getState().removeItem(shape.id);
    expect(useSceneStore.getState().items.get('zoom')).toEqual(zoom);
  });

  it('rejects invalid authored mutations but keeps malformed imported data diagnosable', () => {
    const state = useSceneStore.getState();
    const valid = camera('valid', state.startFrameId, 0, 1);
    state.addCameraMoveClip(valid);
    useSceneStore.getState().updateItem('valid', { targetWidth: 0 });
    useSceneStore.getState().updateItem('valid', { targetFrameId: 'missing' });
    useSceneStore.getState().moveItem('valid', Number.NaN);
    useSceneStore.getState().resizeItem('valid', Number.POSITIVE_INFINITY);
    expect(useSceneStore.getState().items.get('valid')).toEqual(valid);

    const malformed = { ...valid, id: 'malformed', targetWidth: 0 } as CameraMoveItem;
    useSceneStore.getState().loadSceneDocument(
      {
        defaults: state.defaults,
        frames: state.frames,
        startFrameId: state.startFrameId,
        items: [malformed] as SceneItem[],
      },
      42,
    );
    expect(validateCameraMove(useSceneStore.getState().items.get('malformed') as CameraMoveItem, state.frames)).toHaveLength(1);
    expect(resolveCameraSchedule(useSceneStore.getState().items, state.frames, state.startFrameId).diagnostics).toHaveLength(1);
  });

  it('retains a fragment camera with an unresolved target instead of selecting the first frame', () => {
    const state = useSceneStore.getState();
    const fragment: ProjectFragmentFile = {
      kind: 'manim-timeline-fragment',
      version: 42,
      savedAt: '2026-09-24T00:00:00.000Z',
      items: [camera('imported-camera', 'missing-frame', 2, 1, 5)],
    };
    state.importFragment(fragment, { timeMode: 'appendEnd' });
    const imported = [...useSceneStore.getState().items.values()].find((item) => item.kind === 'camera_move')!;
    expect(imported.targetFrameId).toBe('missing-frame');
    expect(resolveCameraSchedule(useSceneStore.getState().items, state.frames, state.startFrameId).diagnostics).toHaveLength(1);
  });
});

function cameraPoseWidth(time: number): number {
  const state = useSceneStore.getState();
  return cameraPoseAtTime(time, state.items, state.frames, state.startFrameId).width;
}
