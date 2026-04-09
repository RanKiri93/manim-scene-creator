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
import { isTopLevelItem, effectiveStart } from '@/lib/time';

export type SceneState = {
  items: Map<ItemId, SceneItem>;
};

function lineHeading(raw: string): string {
  const flat = raw.replace(/\s+/g, ' ');
  const preview = flat.slice(0, 20);
  const suffix = flat.length > 20 ? '…' : '';
  return `## Line: ${preview}${suffix}`;
}

function appendTextLine(lines: string[], item: TextLineItem): void {
  lines.push('');
  lines.push(lineHeading(item.raw ?? ''));
}

function appendAxes(lines: string[], item: AxesItem): void {
  lines.push('');
  lines.push(`## Axes ${item.id}`);
  lines.push(
    `x: [${item.xRange[0]}, ${item.xRange[1]}] step ${item.xRange[2]} — y: [${item.yRange[0]}, ${item.yRange[1]}] step ${item.yRange[2]}`,
  );
  lines.push(`Labels: ${item.xLabel}, ${item.yLabel}`);
}

function appendGraphPlot(lines: string[], item: GraphPlotItem): void {
  lines.push('');
  lines.push(`## Graph plot → axes ${item.axesId}`);
  const fn = item.fn;
  lines.push('');
  lines.push(`Py: ${(fn.pyExpr ?? '').trim() || '(empty)'}`);
}

function appendGraphDot(lines: string[], item: GraphDotItem): void {
  lines.push('');
  lines.push(`## Graph dot → axes ${item.axesId}`);
}

function appendGraphSeriesViz(lines: string[], item: GraphSeriesVizItem): void {
  lines.push('');
  lines.push(`## Series/sequence viz → axes ${item.axesId}`);
  lines.push('');
  lines.push(`Mode: ${item.vizMode}, n ∈ [${item.nMin}, ${item.nMax}]`);
  lines.push(
    `Py (${item.vizMode === 'partialPlot' ? 'k, x' : 'n'}): ${(item.pyExpr ?? '').trim() || '(empty)'}`,
  );
}

function appendShape(lines: string[], item: ShapeItem): void {
  lines.push('');
  lines.push(`## Shape (${item.shapeType})`);
}

function appendGraphField(lines: string[], item: GraphFieldItem): void {
  lines.push('');
  lines.push(`## Graph field → axes ${item.axesId}`);
  const fm = item.fieldMode ?? 'none';
  if (fm === 'none') return;
  lines.push('');
  lines.push(`**Vector field:** mode=${fm}`);
  if (fm === 'slope') {
    lines.push(`Slope dy/dx (Py): ${(item.pyExprSlope ?? '').trim() || '(empty)'}`);
  } else {
    lines.push(`P (Py): ${(item.pyExprP ?? '').trim() || '(empty)'}`);
    lines.push(`Q (Py): ${(item.pyExprQ ?? '').trim() || '(empty)'}`);
  }
  const seeds = item.streamPoints ?? [];
  if (seeds.length > 0) {
    lines.push(
      `Streamline seeds: ${seeds.map((s) => `(${s.x}, ${s.y})`).join('; ')}`,
    );
  }
}

function appendCompound(
  lines: string[],
  item: CompoundItem,
  items: Map<ItemId, SceneItem>,
): void {
  lines.push('');
  lines.push(`## Compound: ${item.label || item.id}`);
  const children: TextLineItem[] = [];
  for (const cid of item.childIds) {
    const ch = items.get(cid);
    if (ch?.kind === 'textLine') children.push(ch);
  }
  children.sort(
    (a, b) => effectiveStart(a, items) - effectiveStart(b, items),
  );
  for (const child of children) {
    appendTextLine(lines, child);
  }
}

export function exportScriptToMarkdown(state: SceneState): void {
  const { items } = state;
  const ordered = Array.from(items.values())
    .filter(isTopLevelItem)
    .sort(
      (a, b) => effectiveStart(a, items) - effectiveStart(b, items),
    );

  const parts: string[] = ['# Scene outline', ''];
  for (const it of ordered) {
    if (it.kind === 'textLine') appendTextLine(parts, it);
    else if (it.kind === 'axes') appendAxes(parts, it);
    else if (it.kind === 'graphPlot') appendGraphPlot(parts, it);
    else if (it.kind === 'graphDot') appendGraphDot(parts, it);
    else if (it.kind === 'graphField') appendGraphField(parts, it);
    else if (it.kind === 'graphSeriesViz') appendGraphSeriesViz(parts, it);
    else if (it.kind === 'shape') appendShape(parts, it);
    else if (it.kind === 'compound') appendCompound(parts, it, items);
  }

  const md = parts.join('\n');
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'scene_script.md';
  a.rel = 'noopener';
  a.click();
  URL.revokeObjectURL(url);
}
