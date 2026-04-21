import type {
  SceneItem,
  TextLineItem,
  AxesItem,
  GraphPlotItem,
  GraphDotItem,
  GraphFieldItem,
  GraphFunctionSeriesItem,
  GraphAreaItem,
  ShapeItem,
  ItemId,
} from '@/types/scene';
import { isTopLevelItem } from '@/lib/time';

/** Keep in sync with `TIMELINE_GAP_EPS` in manimExporter.ts */
const TIMELINE_ORDER_EPS = 0.001;

/**
 * Top-level timeline order (same order as timeline sort).
 */
export function flattenExportItems(items: SceneItem[]): SceneItem[] {
  return items
    .filter(isTopLevelItem)
    .sort((a, b) => a.startTime - b.startTime || a.layer - b.layer);
}

export type ExportLeaf =
  | TextLineItem
  | AxesItem
  | GraphPlotItem
  | GraphDotItem
  | GraphFieldItem
  | GraphFunctionSeriesItem
  | GraphAreaItem
  | ShapeItem;

export function flattenExportLeaves(items: SceneItem[]): ExportLeaf[] {
  const base = flattenExportItems(items).filter(
    (it): it is ExportLeaf =>
      it.kind === 'textLine' ||
      it.kind === 'axes' ||
      it.kind === 'graphPlot' ||
      it.kind === 'graphDot' ||
      it.kind === 'graphField' ||
      it.kind === 'graphFunctionSeries' ||
      it.kind === 'graphArea' ||
      it.kind === 'shape',
  );
  return reorderExportLeavesForPlacementDeps(base);
}

function leafStart(leaf: ExportLeaf): number {
  return leaf.startTime;
}

function nextToRefIds(leaf: ExportLeaf): ItemId[] {
  if (
    leaf.kind !== 'textLine' &&
    leaf.kind !== 'axes' &&
    leaf.kind !== 'shape'
  ) {
    return [];
  }
  const out: ItemId[] = [];
  for (const step of leaf.posSteps) {
    if (step.kind === 'next_to' && step.refId) out.push(step.refId);
  }
  return out;
}

/**
 * Build a linear export order that respects:
 * - strict timeline: if A starts before B (by TIMELINE_ORDER_EPS), A appears before B
 * - next_to: reference mobject is defined before the clip that uses it
 *
 * Needed when concurrent clips share `startTime` but `layer` order disagrees with next_to,
 * e.g. after merging fragments or editing.
 */
export function reorderExportLeavesForPlacementDeps(
  leaves: ExportLeaf[],
): ExportLeaf[] {
  if (leaves.length <= 1) return leaves;

  const byId = new Map<ItemId, ExportLeaf>(leaves.map((L) => [L.id, L]));
  const origIdx = new Map<ItemId, number>(leaves.map((L, i) => [L.id, i]));

  function tieCompare(a: ItemId, b: ItemId): number {
    const la = byId.get(a)!;
    const lb = byId.get(b)!;
    const ts = leafStart(la) - leafStart(lb);
    if (Math.abs(ts) > TIMELINE_ORDER_EPS) return ts;
    if (la.layer !== lb.layer) return la.layer - lb.layer;
    return (origIdx.get(a) ?? 0) - (origIdx.get(b) ?? 0);
  }

  const ids = leaves.map((l) => l.id);
  const adj = new Map<ItemId, Set<ItemId>>();

  function addEdge(u: ItemId, v: ItemId) {
    if (u === v || !byId.has(u) || !byId.has(v)) return;
    let s = adj.get(u);
    if (!s) {
      s = new Set();
      adj.set(u, s);
    }
    s.add(v);
  }

  for (let i = 0; i < leaves.length; i++) {
    for (let j = 0; j < leaves.length; j++) {
      if (i === j) continue;
      const a = leaves[i]!;
      const b = leaves[j]!;
      if (leafStart(a) + TIMELINE_ORDER_EPS < leafStart(b)) {
        addEdge(a.id, b.id);
      }
    }
  }

  for (const L of leaves) {
    if (L.kind !== 'textLine' && L.kind !== 'axes' && L.kind !== 'shape') {
      continue;
    }
    for (const rId of nextToRefIds(L)) {
      if (byId.has(rId)) addEdge(rId, L.id);
    }
  }

  for (const L of leaves) {
    if (
      L.kind === 'graphPlot' ||
      L.kind === 'graphDot' ||
      L.kind === 'graphField' ||
      L.kind === 'graphFunctionSeries' ||
      L.kind === 'graphArea'
    ) {
      if (byId.has(L.axesId)) addEdge(L.axesId, L.id);
    }
  }

  const indeg = new Map<ItemId, number>();
  for (const id of ids) indeg.set(id, 0);
  for (const outs of adj.values()) {
    for (const v of outs) {
      indeg.set(v, (indeg.get(v) ?? 0) + 1);
    }
  }

  const ready = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  ready.sort(tieCompare);

  const result: ExportLeaf[] = [];
  while (ready.length > 0) {
    const u = ready.shift()!;
    result.push(byId.get(u)!);
    for (const v of adj.get(u) ?? []) {
      const next = (indeg.get(v) ?? 0) - 1;
      indeg.set(v, next);
      if (next === 0) {
        ready.push(v);
        ready.sort(tieCompare);
      }
    }
  }

  if (result.length !== leaves.length) {
    throw new Error(
      'Export order is impossible: clip start times and next_to positioning form a cycle. ' +
        'Adjust start times on the timeline or change next_to references.',
    );
  }

  return result;
}
