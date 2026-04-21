import type {
  ItemId,
  SceneItem,
  AxesItem,
  GraphFieldItem,
  GraphFunctionSeriesItem,
} from '@/types/scene';
import { functionSeriesHasErrors } from '@/types/scene';
import { effectiveStart, effectiveEnd } from '@/lib/time';

/** Stacking on a shared axes: lower values draw farther back when layer ties. */
function graphOverlayKindRank(kind: SceneItem['kind']): number {
  switch (kind) {
    case 'graphArea':
      return -1;
    case 'graphPlot':
      return 0;
    // Function series shares the plot band; draws right after regular plots when layers tie.
    case 'graphFunctionSeries':
      return 0.5;
    case 'graphField':
      return 1;
    case 'graphDot':
      return 3;
    default:
      return 99;
  }
}

export type GraphAxesDrawKind =
  | 'area'
  | 'plot'
  | 'dot'
  | 'field'
  | 'functionSeries';

export interface GraphAxesDrawSlot {
  kind: GraphAxesDrawKind;
  layer: number;
  id: ItemId;
}

function slotKindToSceneKind(k: GraphAxesDrawKind): SceneItem['kind'] {
  switch (k) {
    case 'area':
      return 'graphArea';
    case 'plot':
      return 'graphPlot';
    case 'dot':
      return 'graphDot';
    case 'field':
      return 'graphField';
    case 'functionSeries':
      return 'graphFunctionSeries';
  }
}

/** Sort graph overlays that share an axes (canvas + Manim z_index). */
export function compareGraphStackOverlays(a: SceneItem, b: SceneItem): number {
  if (a.layer !== b.layer) return a.layer - b.layer;
  const rk = graphOverlayKindRank(a.kind) - graphOverlayKindRank(b.kind);
  if (rk !== 0) return rk;
  return a.id.localeCompare(b.id);
}

/**
 * Draw order inside one axes group on the canvas. Uses each clip's `layer` (higher = on top);
 * when layers match: areas → plots → field → dots.
 */
export function cumulativeAxesDrawOrder(
  axesId: ItemId,
  time: number,
  items: Map<ItemId, SceneItem>,
  field: GraphFieldItem | null,
): GraphAxesDrawSlot[] {
  const slots: GraphAxesDrawSlot[] = [];
  for (const it of items.values()) {
    if (it.kind === 'graphArea' && it.axesId === axesId && time >= effectiveStart(it, items)) {
      slots.push({ kind: 'area', layer: it.layer, id: it.id });
    }
    if (it.kind === 'graphPlot' && it.axesId === axesId && time >= effectiveStart(it, items)) {
      slots.push({ kind: 'plot', layer: it.layer, id: it.id });
    }
    if (
      it.kind === 'graphFunctionSeries' &&
      it.axesId === axesId &&
      time >= effectiveStart(it, items)
    ) {
      slots.push({ kind: 'functionSeries', layer: it.layer, id: it.id });
    }
    if (it.kind === 'graphDot' && it.axesId === axesId && time >= effectiveStart(it, items)) {
      slots.push({ kind: 'dot', layer: it.layer, id: it.id });
    }
  }
  if (field && field.fieldMode !== 'none') {
    slots.push({ kind: 'field', layer: field.layer, id: field.id });
  }
  slots.sort((a, b) => {
    if (a.layer !== b.layer) return a.layer - b.layer;
    const ar =
      graphOverlayKindRank(slotKindToSceneKind(a.kind)) -
      graphOverlayKindRank(slotKindToSceneKind(b.kind));
    if (ar !== 0) return ar;
    return a.id.localeCompare(b.id);
  });
  return slots;
}

/** Whether a function series has any error (top-level or per-n) that disables playback. */
export function functionSeriesIsDisabled(
  item: GraphFunctionSeriesItem,
): boolean {
  return functionSeriesHasErrors(item);
}

export function graphGroupShouldRender(
  axes: AxesItem,
  time: number,
  items: Map<ItemId, SceneItem>,
): boolean {
  if (time < effectiveStart(axes, items)) return false;
  for (const it of items.values()) {
    if (
      (it.kind === 'graphPlot' ||
        it.kind === 'graphDot' ||
        it.kind === 'graphField' ||
        it.kind === 'graphFunctionSeries' ||
        it.kind === 'graphArea') &&
      it.axesId === axes.id &&
      time >= effectiveStart(it, items)
    ) {
      return true;
    }
  }
  return time < effectiveEnd(axes, items);
}

/** Latest-started field at or before `time` (by effective start). */
export function cumulativeField(
  axesId: ItemId,
  time: number,
  items: Map<ItemId, SceneItem>,
): GraphFieldItem | null {
  let best: GraphFieldItem | null = null;
  let bestT = -Infinity;
  for (const it of items.values()) {
    if (it.kind !== 'graphField' || it.axesId !== axesId || it.fieldMode === 'none') continue;
    const t0 = effectiveStart(it, items);
    if (t0 <= time && t0 >= bestT) {
      best = it;
      bestT = t0;
    }
  }
  return best;
}

