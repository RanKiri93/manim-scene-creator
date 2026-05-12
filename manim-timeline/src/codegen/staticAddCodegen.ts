import type { ExportLeaf } from './flattenExport';
import {
  graphAreaBoundaryPlotVars,
  overlayAreaVar,
  overlayCurveVar,
  overlayDotVar,
  overlayPlotVar,
  overlayPointSequenceGroupVar,
  pythonOverlaySuffix,
} from './graphCodegen';
import type { ItemId, SceneItem } from '@/types/scene';
import { isVisibleAtSceneStartItem } from '@/types/scene';

function staticAddExprsForLeaf(
  leaf: ExportLeaf,
  idToVarName: Map<ItemId, string>,
): string[] {
  switch (leaf.kind) {
    case 'textLine':
      return [idToVarName.get(leaf.id)!];
    case 'axes': {
      const ax = idToVarName.get(leaf.id)!;
      const parts: string[] = [ax];
      if (leaf.xLabel?.trim()) parts.push(`${ax}_xlabel`);
      if (leaf.yLabel?.trim()) parts.push(`${ax}_ylabel`);
      return parts;
    }
    case 'graphPlot': {
      const ax = idToVarName.get(leaf.axesId);
      if (!ax) return [];
      return [overlayPlotVar(ax, leaf.id)];
    }
    case 'graphCurve': {
      const ax = idToVarName.get(leaf.axesId);
      if (!ax) return [];
      return [overlayCurveVar(ax, leaf.id)];
    }
    case 'graphDot': {
      const ax = idToVarName.get(leaf.axesId);
      if (!ax) return [];
      const d = overlayDotVar(ax, leaf.id);
      return leaf.dot.label.trim() ? [d, `${d}_lbl`] : [d];
    }
    case 'graphField': {
      if (leaf.fieldMode === 'none') return [];
      const ax = idToVarName.get(leaf.axesId);
      if (!ax) return [];
      const suf = pythonOverlaySuffix(leaf.id);
      const vf = `${ax}_vf_${suf}`;
      const seeds = leaf.streamPoints ?? [];
      return seeds.length > 0 ? [vf, `${ax}_streams_${suf}`] : [vf];
    }
    case 'graphArea': {
      const ax = idToVarName.get(leaf.axesId);
      if (!ax) return [];
      return [...graphAreaBoundaryPlotVars(leaf, ax), overlayAreaVar(ax, leaf.id)];
    }
    case 'graphFunctionSeries': {
      const ax = idToVarName.get(leaf.axesId);
      if (!ax) return [];
      return [`${ax}_fs_${pythonOverlaySuffix(leaf.id)}`];
    }
    case 'graphPointSequence': {
      const ax = idToVarName.get(leaf.axesId);
      if (!ax) return [];
      return [overlayPointSequenceGroupVar(ax, leaf.id)];
    }
    case 'shape':
      return [idToVarName.get(leaf.id)!];
    default:
      return [];
  }
}

/** Emit `self.add(...)` for items flagged visible at scene start, after defs/pos. */
export function generateSceneStartStaticAdds(
  flat: ExportLeaf[],
  items: SceneItem[],
  idToVarName: Map<ItemId, string>,
  indent: number,
): string {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];
  for (const leaf of flat) {
    if (!isVisibleAtSceneStartItem(leaf)) continue;
    for (const ex of staticAddExprsForLeaf(leaf, idToVarName)) {
      if (ex) lines.push(`${pad}self.add(${ex})`);
    }
  }
  for (const it of items) {
    if (it.kind !== 'surroundingRect') continue;
    if (!isVisibleAtSceneStartItem(it)) continue;
    const sv = idToVarName.get(it.id);
    if (!sv) continue;
    lines.push(`${pad}self.add(${sv})`);
    if (it.labelText.trim()) {
      lines.push(`${pad}self.add(${sv}_lbl)`);
    }
  }
  if (!lines.length) return '';
  return `${lines.join('\n')}\n`;
}
