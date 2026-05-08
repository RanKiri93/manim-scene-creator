import { useMemo } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { ItemId, SceneItem } from '@/types/scene';
import { useAgentStore } from './useAgentStore';
import type { AgentAction } from './types';

export type PreviewOp = 'create' | 'update' | 'delete';

export interface PreviewState {
  /** Map of items as they'd look if the pending actions were committed. */
  mergedItems: Map<ItemId, SceneItem>;
  /** Only the ids touched by the pending actions and their op kind. */
  ops: Map<ItemId, PreviewOp>;
}

const EMPTY_OPS: Map<ItemId, PreviewOp> = new Map();

/**
 * Look up the pending actions (if any) of the currently active preview message.
 * Returns `null` when no message is driving the preview.
 */
function useActivePreviewActions(): AgentAction[] | null {
  const activeId = useAgentStore((s) => s.activePreviewMessageId);
  const messages = useAgentStore((s) => s.messages);
  return useMemo(() => {
    if (!activeId) return null;
    const msg = messages.find((m) => m.id === activeId);
    if (!msg || msg.role !== 'assistant') return null;
    if (msg.actionsStatus !== 'pending') return null;
    if (!msg.actions || msg.actions.length === 0) return null;
    return msg.actions;
  }, [activeId, messages]);
}

/** React hook: merged item map for canvas/timeline preview rendering. */
export function usePreviewMergedItems(): Map<ItemId, SceneItem> {
  const items = useSceneStore((s) => s.items);
  const actions = useActivePreviewActions();
  return useMemo(() => {
    if (!actions) return items;
    return buildPreviewState(items, actions).mergedItems;
  }, [items, actions]);
}

/** React hook: map of item id → preview op (create | update | delete). */
export function usePreviewOps(): Map<ItemId, PreviewOp> {
  const items = useSceneStore((s) => s.items);
  const actions = useActivePreviewActions();
  return useMemo(() => {
    if (!actions) return EMPTY_OPS;
    return buildPreviewState(items, actions).ops;
  }, [items, actions]);
}

/** Exposed for tests and non-React consumers. */
export function buildPreviewState(
  items: Map<ItemId, SceneItem>,
  actions: AgentAction[],
): PreviewState {
  const merged = new Map<ItemId, SceneItem>(items);
  const ops = new Map<ItemId, PreviewOp>();
  for (const a of actions) {
    if (a.action === 'CREATE') {
      merged.set(a.item.id, a.item);
      ops.set(a.item.id, 'create');
    } else if (a.action === 'UPDATE') {
      const current = merged.get(a.itemId);
      if (!current) continue;
      merged.set(a.itemId, {
        ...current,
        ...(a.updates as Partial<SceneItem>),
      } as SceneItem);
      if (!ops.has(a.itemId)) ops.set(a.itemId, 'update');
    } else {
      // DELETE — keep the item in the merged map so the UI can render it
      // with a "will be deleted" styling; `ops` flags it for the renderer
      // to skip commit effects.
      if (merged.has(a.itemId)) ops.set(a.itemId, 'delete');
    }
  }
  return { mergedItems: merged, ops };
}
