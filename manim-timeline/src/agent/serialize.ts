import type {
  ItemId,
  SceneDefaults,
  SceneItem,
} from '@/types/scene';
import {
  AGENT_UI_ONLY_FIELDS,
  type AgentContextPayload,
  type MinimalSceneItem,
} from './types';

/** Drop UI-only transient fields so the LLM doesn't see (or learn to emit) them. */
export function stripUiFields(item: SceneItem): MinimalSceneItem {
  const copy: Record<string, unknown> = { ...(item as unknown as Record<string, unknown>) };
  for (const key of AGENT_UI_ONLY_FIELDS) {
    delete copy[key];
  }
  return copy as unknown as MinimalSceneItem;
}

interface BuildPayloadInput {
  defaults: SceneDefaults;
  currentTime: number;
  items: Map<ItemId, SceneItem> | Iterable<SceneItem>;
}

/**
 * Build the slim context payload sent to the LLM on every request.
 * Accepts the parts of the store we care about so it's easy to test.
 */
export function buildContextPayload(input: BuildPayloadInput): AgentContextPayload {
  const raw: SceneItem[] = [];
  if (input.items instanceof Map) {
    for (const v of input.items.values()) raw.push(v);
  } else {
    for (const v of input.items) raw.push(v);
  }
  return {
    projectDefaults: { ...input.defaults },
    currentTimeSec: input.currentTime,
    existingItems: raw.map(stripUiFields),
  };
}
