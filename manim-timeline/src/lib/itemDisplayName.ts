import type { ItemId, SceneItem } from '@/types/scene';
import { effectiveStart } from '@/lib/time';

function trunc(s: string, max: number): string {
  const t = s.trim();
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * Short label for timeline bars, item list, etc.
 * Prefer the user-set clip `label`; otherwise a distinctive per-kind fallback.
 */
export function itemClipDisplayName(item: SceneItem): string {
  if (item.kind === 'exit_animation') {
    return item.label.trim() || 'Exit';
  }
  if ('label' in item && item.label?.trim()) {
    return item.label.trim();
  }
  switch (item.kind) {
    case 'textLine':
      return trunc(item.raw, 30) || 'Empty line';
    case 'axes': {
      const xy = [item.xLabel, item.yLabel].filter(Boolean).join(', ');
      return xy ? `Axes (${trunc(xy, 20)})` : 'Axes';
    }
    case 'graphPlot': {
      const bit = item.fn.label?.trim() || trunc(item.fn.pyExpr, 22);
      return bit ? `Plot: ${bit}` : 'Plot';
    }
    case 'graphDot': {
      const bit = item.dot.label?.trim();
      return bit ? `Dot: ${trunc(bit, 22)}` : 'Dot';
    }
    case 'graphField':
      return item.fieldMode === 'vector'
        ? 'Vector field'
        : item.fieldMode === 'slope'
          ? 'Slope field'
          : 'Field';
    case 'graphSeriesViz': {
      const bit = trunc(item.voiceText, 18) || trunc(item.jsExpr, 18);
      return bit ? `Series: ${bit}` : 'Series viz';
    }
    case 'compound':
      return `Compound (${item.childIds.length})`;
    default:
      return '?';
  }
}

/**
 * One line per `<option>` when choosing an exit target: name, global start, kind, id tail.
 */
export function exitTargetSelectLabel(
  item: SceneItem,
  itemsMap: Map<ItemId, SceneItem>,
): string {
  const name = itemClipDisplayName(item);
  const t0 = effectiveStart(item, itemsMap).toFixed(2);
  const idShort = item.id.length > 10 ? `${item.id.slice(0, 10)}…` : item.id;
  const kindHint =
    item.kind === 'textLine' && item.parentId ? 'line in compound' : item.kind;
  return `${name}  ·  @${t0}s  ·  ${kindHint}  ·  ${idShort}`;
}
