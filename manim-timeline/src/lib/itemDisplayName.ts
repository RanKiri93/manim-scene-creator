import type { ItemId, SceneItem } from '@/types/scene';
import { effectiveStart } from '@/lib/time';
import { FRAME_W } from '@/lib/constants';

function trunc(s: string, max: number): string {
  const t = s.trim();
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

const KIND_LABEL: Record<SceneItem['kind'], string> = {
  textLine: 'Text line',
  axes: 'Axes',
  graphPlot: 'Graph plot',
  graphCurve: 'Graph curve',
  graphDot: 'Graph dot',
  graphField: 'Vector field',
  graphFunctionSeries: 'Function series',
  graphPointSequence: 'Point sequence',
  graphArea: 'Graph area',
  shape: 'Shape',
  surroundingRect: 'Surrounding rectangle',
  image: 'Image',
  exit_animation: 'Exit animation',
  blink_animation: 'Blink animation',
  target_animation: 'Target animation',
  camera_move: 'Camera move',
};

/** Human name of an item kind ("Graph plot"), for headings. Exhaustive over `SceneItem['kind']`. */
export function itemKindLabel(kind: SceneItem['kind']): string {
  return KIND_LABEL[kind];
}

/**
 * Short label for timeline bars, item list, etc.
 * Prefer the user-set clip `label`; otherwise a distinctive per-kind fallback.
 */
export function itemClipDisplayName(item: SceneItem): string {
  if (item.kind === 'exit_animation') {
    return item.label.trim() || 'Exit';
  }
  if (item.kind === 'blink_animation') {
    return item.label.trim() || 'Blink';
  }
  if (item.kind === 'target_animation') {
    if (item.label.trim()) return item.label.trim();
    const m = item.mode;
    if (m === 'scale') return 'Target · scale';
    if (m === 'color') return 'Target · color';
    if (m === 'move') return 'Target · move';
    if (m === 'path') return 'Target · path';
    if (m === 'rotate') return 'Target · rotate';
    if (m === 'graphFollow') return 'Move along graph';
    return 'Target animation';
  }
  if (item.kind === 'camera_move') {
    if (item.label.trim()) return item.label.trim();
    if (Math.abs((item.targetWidth ?? FRAME_W) - FRAME_W) <= 1e-6) return 'Zoom to frame';
    return 'Zoom to region';
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
    case 'graphCurve': {
      const bit =
        item.curve.label?.trim() ||
        trunc(`(${item.curve.pyXExpr}, ${item.curve.pyYExpr})`, 22);
      return bit ? `Curve: ${bit}` : 'Curve';
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
    case 'graphFunctionSeries': {
      const bit = trunc(item.jsExpr, 22);
      const range = `n=${item.nMin}..${item.nMax}`;
      return bit ? `f(n,x)=${bit} [${range}]` : `Function series [${range}]`;
    }
    case 'graphPointSequence': {
      const xr = trunc(item.pyXExpr, 12);
      const yr = trunc(item.pyYExpr, 12);
      const range = `n=${item.nMin}..${item.nMax}`;
      return `(${xr}, ${yr}) [${range}]`;
    }
    case 'graphArea':
      return 'Graph area';
    case 'surroundingRect': {
      return item.label.trim() || 'Surrounding rect';
    }
    case 'shape': {
      const t = item.shapeType;
      return item.label.trim() || `${t[0]!.toUpperCase()}${t.slice(1)}`;
    }
    case 'image': {
      const base = item.fileName.trim() || 'picture';
      return `Image: ${trunc(base, 24)}`;
    }
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
  const kindHint = item.kind;
  return `${name}  ·  @${t0}s  ·  ${kindHint}  ·  ${idShort}`;
}
