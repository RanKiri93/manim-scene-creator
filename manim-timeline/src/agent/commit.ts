import { useSceneStore } from '@/store/useSceneStore';
import type {
  FunctionSeriesDefaults,
  FunctionSeriesPerN,
  GraphCurveItem,
  GraphFunctionSeriesItem,
  GraphPointSequenceItem,
  PointSequenceDefaults,
  PointSequencePerN,
  SceneItem,
  TextLineItem,
} from '@/types/scene';
import { parseSegments } from '@/codegen/texUtils';
import { createSegmentStyle } from '@/store/factories';
import type { AgentAction } from './types';

/**
 * Apply a validated list of agent actions to the main scene store. Actions are
 * applied in the order the agent emitted them so it can express dependencies
 * (e.g. create an axes before a graphPlot that references it, or create an item
 * and then update it in the same batch). Each action triggers one zundo
 * snapshot — batching into a single undo entry is a future follow-up.
 *
 * We re-read `getState()` for every action so UPDATE / DELETE see the mutations
 * made by earlier CREATEs in the same batch, not a stale initial snapshot.
 */
export function commitActions(actions: AgentAction[]): void {
  for (const action of actions) {
    const s = useSceneStore.getState();
    if (action.action === 'CREATE') {
      s.addItem(ensureTextLineSegments(action.item, s.defaults));
    } else if (action.action === 'UPDATE') {
      applyUpdate(action.itemId, action.updates);
    } else {
      if (s.items.has(action.itemId)) s.removeItem(action.itemId);
    }
  }
}

/**
 * If the agent created a textLine with `raw` set but `segments` empty,
 * auto-populate segments by parsing `raw` — mirroring the behaviour of
 * `LineEditor.onRawChange` so styling can be applied immediately afterward.
 */
function ensureTextLineSegments(
  item: SceneItem,
  defaults: ReturnType<typeof useSceneStore.getState>['defaults'],
): SceneItem {
  if (item.kind !== 'textLine') return item;
  const tl = item as TextLineItem;
  if (!tl.raw.trim() || tl.segments.length > 0) return item;
  const parsed = parseSegments(tl.raw);
  const segments = parsed.map((p) => createSegmentStyle(p.text, p.isMath, defaults));
  return { ...tl, segments };
}

function applyUpdate(id: string, updates: Partial<SceneItem>): void {
  const s = useSceneStore.getState();
  const existing = s.items.get(id);
  if (!existing) return;

  // Kind-specific deep-merge: LLMs frequently "helpfully" regenerate nested
  // dictionaries from a partial view of the item, which would otherwise wipe
  // user-authored entries. We merge at the right granularity so the patch
  // only touches the fields the LLM actually specified.
  if (existing.kind === 'graphFunctionSeries') {
    const merged = mergeFunctionSeriesUpdates(
      existing as GraphFunctionSeriesItem,
      updates as Partial<GraphFunctionSeriesItem>,
    );
    s.updateItem(id, merged as never);
    return;
  }

  if (existing.kind === 'graphPointSequence') {
    const merged = mergePointSequenceUpdates(
      existing as GraphPointSequenceItem,
      updates as Partial<GraphPointSequenceItem>,
    );
    s.updateItem(id, merged as never);
    return;
  }

  if (existing.kind === 'graphCurve') {
    const merged = mergeGraphCurveUpdates(
      existing as GraphCurveItem,
      updates as Partial<GraphCurveItem>,
    );
    s.updateItem(id, merged as never);
    return;
  }

  s.updateItem(id, updates as never);
}

/**
 * Deep-merge an UPDATE patch for a `graphFunctionSeries` item so that nested
 * state (`perN`, `defaults`) is never blindly overwritten by a partial LLM
 * patch. This is the single source of truth for keeping the Properties panel
 * UI in sync with agent edits:
 *
 *   • `perN` is merged entry-by-entry. If the patch only specifies styling
 *     for `n=3`, the existing styling for `n=2` is preserved verbatim.
 *   • Within each per-n entry, individual fields are merged (so the LLM can
 *     tweak only `color` without clearing `strokeWidth`).
 *   • `defaults` is shallow-merged over the existing defaults.
 *   • Scalar top-level fields (`nMin`, `nMax`, `mode`, `jsExpr`, `pyExpr`,
 *     `xDomain`, etc.) pass through unchanged — the validator already
 *     normalized them.
 *
 * Returns a new patch object (never mutates `existing` or `patch`).
 */
function mergeFunctionSeriesUpdates(
  existing: GraphFunctionSeriesItem,
  patch: Partial<GraphFunctionSeriesItem>,
): Partial<GraphFunctionSeriesItem> {
  const out: Partial<GraphFunctionSeriesItem> = { ...patch };

  if (patch.perN && typeof patch.perN === 'object') {
    const mergedPerN: Record<string, FunctionSeriesPerN> = { ...existing.perN };
    for (const [key, incoming] of Object.entries(patch.perN)) {
      if (!incoming || typeof incoming !== 'object') continue;
      const prev = mergedPerN[key] ?? {};
      mergedPerN[key] = { ...prev, ...incoming };
    }
    out.perN = mergedPerN;
  }

  if (patch.defaults && typeof patch.defaults === 'object') {
    out.defaults = {
      ...existing.defaults,
      ...patch.defaults,
    } as FunctionSeriesDefaults;
  }

  return out;
}

function mergePointSequenceUpdates(
  existing: GraphPointSequenceItem,
  patch: Partial<GraphPointSequenceItem>,
): Partial<GraphPointSequenceItem> {
  const out: Partial<GraphPointSequenceItem> = { ...patch };

  if (patch.perN && typeof patch.perN === 'object') {
    const mergedPerN: Record<string, PointSequencePerN> = { ...existing.perN };
    for (const [key, incoming] of Object.entries(patch.perN)) {
      if (!incoming || typeof incoming !== 'object') continue;
      const prev = mergedPerN[key] ?? {};
      mergedPerN[key] = { ...prev, ...incoming };
    }
    out.perN = mergedPerN;
  }

  if (patch.defaults && typeof patch.defaults === 'object') {
    out.defaults = {
      ...existing.defaults,
      ...patch.defaults,
    } as PointSequenceDefaults;
  }

  return out;
}

function mergeGraphCurveUpdates(
  existing: GraphCurveItem,
  patch: Partial<GraphCurveItem>,
): Partial<GraphCurveItem> {
  const out: Partial<GraphCurveItem> = { ...patch };
  if (patch.curve && typeof patch.curve === 'object') {
    out.curve = {
      ...existing.curve,
      ...patch.curve,
    };
  }
  return out;
}
