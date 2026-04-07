import type {
  ItemId,
  SceneItem,
  AxesItem,
  GraphFunction,
  GraphDot,
  GraphFieldItem,
  GraphSeriesVizItem,
} from '@/types/scene';
import { effectiveStart, effectiveEnd } from '@/lib/time';

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
        it.kind === 'graphSeriesViz') &&
      it.axesId === axes.id &&
      time >= effectiveStart(it, items)
    ) {
      return true;
    }
  }
  return time < effectiveEnd(axes, items);
}

export function cumulativePlots(
  axesId: ItemId,
  time: number,
  items: Map<ItemId, SceneItem>,
): GraphFunction[] {
  const out: GraphFunction[] = [];
  for (const it of items.values()) {
    if (it.kind === 'graphPlot' && it.axesId === axesId && time >= effectiveStart(it, items)) {
      out.push(it.fn);
    }
  }
  return out;
}

export function cumulativeDots(
  axesId: ItemId,
  time: number,
  items: Map<ItemId, SceneItem>,
): GraphDot[] {
  const out: GraphDot[] = [];
  for (const it of items.values()) {
    if (it.kind === 'graphDot' && it.axesId === axesId && time >= effectiveStart(it, items)) {
      out.push(it.dot);
    }
  }
  return out;
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

/** Active series/sequence visualizer for canvas (latest by start time within clip). */
export function cumulativeSeriesViz(
  axesId: ItemId,
  time: number,
  items: Map<ItemId, SceneItem>,
): GraphSeriesVizItem | null {
  let best: GraphSeriesVizItem | null = null;
  let bestT = -Infinity;
  for (const it of items.values()) {
    if (it.kind !== 'graphSeriesViz' || it.axesId !== axesId) continue;
    const t0 = effectiveStart(it, items);
    const t1 = t0 + it.duration;
    if (time < t0 || time >= t1) continue;
    if (t0 >= bestT) {
      best = it;
      bestT = t0;
    }
  }
  return best;
}
