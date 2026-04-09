import type {
  SceneItem,
  TextLineItem,
  AxesItem,
  GraphPlotItem,
  GraphDotItem,
  GraphFieldItem,
  GraphSeriesVizItem,
  ShapeItem,
  CompoundItem,
  ItemId,
} from '@/types/scene';
import { isTopLevelItem } from '@/lib/time';

/**
 * Top-level timeline order expanded so compound clips become their child text lines in order.
 * Axes and graph overlays appear where they occur in time order.
 */
export function flattenExportItems(items: SceneItem[]): SceneItem[] {
  const map = new Map<ItemId, SceneItem>(items.map((i) => [i.id, i]));
  const top = items
    .filter(isTopLevelItem)
    .sort((a, b) => a.startTime - b.startTime || a.layer - b.layer);

  const out: SceneItem[] = [];
  for (const it of top) {
    if (it.kind === 'compound') {
      const c = it as CompoundItem;
      for (const cid of c.childIds) {
        const ch = map.get(cid);
        if (ch?.kind === 'textLine') out.push(ch);
      }
    } else {
      out.push(it);
    }
  }
  return out;
}

export type ExportLeaf =
  | TextLineItem
  | AxesItem
  | GraphPlotItem
  | GraphDotItem
  | GraphFieldItem
  | GraphSeriesVizItem
  | ShapeItem;

export function flattenExportLeaves(items: SceneItem[]): ExportLeaf[] {
  return flattenExportItems(items).filter(
    (it): it is ExportLeaf =>
      it.kind === 'textLine' ||
      it.kind === 'axes' ||
      it.kind === 'graphPlot' ||
      it.kind === 'graphDot' ||
      it.kind === 'graphField' ||
      it.kind === 'graphSeriesViz' ||
      it.kind === 'shape',
  );
}
