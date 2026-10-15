import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSceneStore } from '@/store/useSceneStore';

const mocks = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('./providers', () => ({ getProvider: () => ({ generate: mocks.generate }), getLoopProvider: () => null, AgentProviderError: class extends Error {} }));

import { useAgentStore } from './useAgentStore';

describe('camera request lifecycle', () => {
  beforeEach(() => {
    useAgentStore.getState().newChat();
    useAgentStore.getState().updateSettings({ apiKey: 'test-only' });
    mocks.generate.mockReset();
  });

  it('rejects stale camera proposals at approval without partially committing', async () => {
    const startFrameId = useSceneStore.getState().startFrameId;
    mocks.generate.mockResolvedValue({ reply: 'zoom', actions: [{ action: 'CREATE', item: { id: 'cam-proposal', kind: 'camera_move', label: 'Zoom', targetMode: 'frame', targetFrameId: startFrameId, startTime: 5, duration: 1 } }] });
    await useAgentStore.getState().sendMessage('zoom now');
    const message = useAgentStore.getState().messages.at(-1)!;
    expect(message.actions?.[0]).toMatchObject({ action: 'CREATE', item: { kind: 'camera_move' } });
    useSceneStore.setState((state) => { state.currentTime += 1; state.items.set('external-camera', { id: 'external-camera', kind: 'camera_move', label: 'Another view', layer: 0, startTime: 6, duration: 1, targetFrameId: startFrameId!, targetWidth: 5 }); });
    useAgentStore.getState().approveMessage(message.id);
    expect(useSceneStore.getState().items.has('cam-proposal')).toBe(false);
    expect(useAgentStore.getState().messages.at(-1)?.actionsStatus).toBe('rejected');
  });

  it('sends the playhead captured before waiting for the provider', async () => {
    useSceneStore.setState((state) => { state.currentTime = 5; });
    let release!: (value: unknown) => void;
    let observedTime = -1;
    mocks.generate.mockImplementation((input: { payload: { currentTimeSec: number } }) => {
      observedTime = input.payload.currentTimeSec;
      return new Promise((resolve) => { release = resolve; });
    });
    const request = useAgentStore.getState().sendMessage('talk');
    useSceneStore.setState((state) => { state.currentTime = 9; });
    release({ reply: 'no edits', actions: [] });
    await request;
    expect(observedTime).toBe(5);
  });

  it('resolves request-only target descriptors on camera UPDATEs', async () => {
    const frameId = useSceneStore.getState().startFrameId!;
    useSceneStore.setState((state) => { state.items.set('existing-camera', { id: 'existing-camera', kind: 'camera_move', label: 'Zoom', layer: 0, startTime: 1, duration: 1, targetFrameId: frameId, targetWidth: 4 }); });
    mocks.generate.mockResolvedValue({ reply: 'return to frame', actions: [{ action: 'UPDATE', itemId: 'existing-camera', updates: { targetMode: 'frame', targetFrameId: frameId } }] });
    await useAgentStore.getState().sendMessage('return to frame');
    const action = useAgentStore.getState().messages.at(-1)?.actions?.[0];
    expect(action).toMatchObject({ action: 'UPDATE', itemId: 'existing-camera', updates: { targetFrameId: frameId, targetWidth: expect.any(Number) } });
    if (action?.action === 'UPDATE') expect(action.updates).not.toHaveProperty('targetMode');
  });
});
