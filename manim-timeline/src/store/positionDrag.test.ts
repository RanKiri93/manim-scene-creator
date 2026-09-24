import { beforeEach, describe, expect, it } from 'vitest';
import { createTextLine, defaultSceneDefaults } from '@/store/factories';
import { useSceneStore } from '@/store/useSceneStore';
import { finishPositionDrag } from '@/store/positionDrag';

function reset() {
  useSceneStore.temporal.getState().clear();
  useSceneStore.setState((s) => {
    s.items.clear();
    const line = createTextLine(defaultSceneDefaults());
    line.id = 'drag-line';
    s.items.set(line.id, line);
    s.selectedIds.clear();
  });
  useSceneStore.temporal.getState().clear();
}

describe('position drag transaction', () => {
  beforeEach(reset);

  it('persists the per-line snap gap as placement preference, not attachment', () => {
    const created = useSceneStore.getState().items.get('drag-line');
    expect(created).toMatchObject({ snapBuffer: 0.3 });
    useSceneStore.getState().updateItem('drag-line', { snapBuffer: 0.65 });
    const exported = useSceneStore.getState().toProjectFile();
    const saved = exported.items.find((item) => item.id === 'drag-line');
    expect(saved).toMatchObject({ snapBuffer: 0.65 });
    expect(saved).not.toHaveProperty('snapToId');
  });

  it('commits many live moves as one undoable position change', () => {
    const store = useSceneStore.getState();
    useSceneStore.temporal.getState().pause();
    store.setItemPosition('drag-line', 2, 3);
    store.setItemPosition('drag-line', 4, 5);
    finishPositionDrag('drag-line', { x: 0, y: 0 }, { x: 4, y: 5 });

    expect(useSceneStore.getState().items.get('drag-line')).toMatchObject({ x: 4, y: 5 });
    const temporal = useSceneStore.temporal.getState();
    expect(temporal.pastStates.length).toBe(1);
    temporal.undo();
    expect(useSceneStore.getState().items.get('drag-line')).toMatchObject({ x: 0, y: 0 });
    useSceneStore.temporal.getState().redo();
    expect(useSceneStore.getState().items.get('drag-line')).toMatchObject({ x: 4, y: 5 });
  });

  it('does not create history for a no-op gesture', () => {
    useSceneStore.temporal.getState().pause();
    finishPositionDrag('drag-line', { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(useSceneStore.temporal.getState().pastStates.length).toBe(0);
  });
});
