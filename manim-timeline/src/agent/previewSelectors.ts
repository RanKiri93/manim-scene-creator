import { useMemo } from 'react';
import { locateWord } from './audioEdits';
import { useSceneStore } from '@/store/useSceneStore';
import type { ItemId, SceneItem } from '@/types/scene';
import { useAgentStore } from './useAgentStore';
import type { AgentAction } from './types';
import { applyTimelineEdit } from '@/lib/timelineSurgery';

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
  const draft = useAgentStore((s) => s.draftActions);
  return useMemo(() => {
    // While the tool loop works, its draft drives the preview.
    if (draft && draft.length > 0) return draft;
    if (!activeId) return null;
    const msg = messages.find((m) => m.id === activeId);
    if (!msg || msg.role !== 'assistant') return null;
    if (msg.actionsStatus !== 'pending') return null;
    if (!msg.actions || msg.actions.length === 0) return null;
    return msg.actions;
  }, [activeId, messages, draft]);
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
  let merged = new Map<ItemId, SceneItem>(items);
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
    } else if (a.action === 'TIMELINE') {
      // Clips move like the editor's time edit; audio lanes are previewed where they are.
      const before = merged;
      merged = applyTimelineEdit(merged, [], a.edit).items;
      for (const [id, item] of merged) if (before.get(id) !== item && !ops.has(id)) ops.set(id, 'update');
    } else if (a.action === 'AUDIO') {
      // Narration edits show on the audio lanes after Approve; an anchor's new start shows now.
      if (a.edit.op !== 'anchor') continue;
      const hit = locateWord(useSceneStore.getState().audioItems, a.edit.at);
      const current = merged.get(a.edit.itemId);
      if (!hit || !current) continue;
      merged.set(a.edit.itemId, { ...current, startTime: hit.start } as SceneItem);
      if (!ops.has(a.edit.itemId)) ops.set(a.edit.itemId, 'update');
    } else {
      // DELETE — keep the item in the merged map so the UI can render it
      // with a "will be deleted" styling; `ops` flags it for the renderer
      // to skip commit effects.
      if (merged.has(a.itemId)) ops.set(a.itemId, 'delete');
    }
  }
  return { mergedItems: merged, ops };
}
