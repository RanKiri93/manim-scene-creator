import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSceneStore } from '@/store/useSceneStore';
import type { LoopConversation, LoopStep } from './loop/types';

const mocks = vi.hoisted(() => ({ turns: [] as LoopStep[] }));
vi.mock('./providers', () => ({
  getProvider: () => ({ generate: vi.fn() }),
  getLoopProvider: () => ({
    startConversation: (): LoopConversation => {
      let i = 0;
      return {
        next: async () => mocks.turns[i++]!,
        pushToolResults: () => {},
      };
    },
  }),
  AgentProviderError: class extends Error {},
}));

import { useAgentStore } from './useAgentStore';

const axes = {
  id: 'cpAx', kind: 'axes', label: 'axes', xRange: [0, 1, 0.5], yRange: [0, 1, 0.5], scaleX: 1, scaleY: 1, scale: 1,
};

describe('tool-loop turns in the Copilot store', () => {
  beforeEach(() => {
    useAgentStore.getState().newChat();
    useAgentStore.getState().updateSettings({ apiKey: 'test-only', provider: 'anthropic', useToolLoop: true });
    useSceneStore.setState((s) => {
      s.items.clear();
    });
    useSceneStore.temporal.setState({ pastStates: [], futureStates: [] });
    mocks.turns = [
      { text: '', toolCalls: [{ id: '1', name: 'propose_changes', input: { actions: [{ action: 'CREATE', item: axes }] } }] },
      { text: '', toolCalls: [{ id: '2', name: 'finish', input: { reply: 'Axes added.' } }] },
    ];
  });

  it('applies the finished draft as one undo step when auto-apply is on', async () => {
    useAgentStore.getState().updateSettings({ autoApply: true });
    await useAgentStore.getState().sendMessage('axes on [0,1]');
    const message = useAgentStore.getState().messages.at(-1)!;
    expect(message.content).toBe('Axes added.');
    expect(message.actionsStatus).toBe('approved');
    expect(message.autoApplied).toBe(true);
    expect(message.log?.map((l) => l.tool)).toEqual(['propose_changes', 'finish']);
    expect(useSceneStore.getState().items.has('cpAx')).toBe(true);
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(1);
    expect(useAgentStore.getState().draftActions).toBeNull();
  });

  it('waits for Approve when auto-apply is off', async () => {
    useAgentStore.getState().updateSettings({ autoApply: false });
    await useAgentStore.getState().sendMessage('axes on [0,1]');
    const message = useAgentStore.getState().messages.at(-1)!;
    expect(message.actionsStatus).toBe('pending');
    expect(useAgentStore.getState().activePreviewMessageId).toBe(message.id);
    expect(useSceneStore.getState().items.has('cpAx')).toBe(false);
    useAgentStore.getState().approveMessage(message.id);
    expect(useSceneStore.getState().items.has('cpAx')).toBe(true);
  });
});
