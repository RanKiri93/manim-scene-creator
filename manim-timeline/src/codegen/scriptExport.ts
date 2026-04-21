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
  lines.push(`Scale: x=${item.scaleX}, y=${item.scaleY} (Manim units per graph unit)`);
  lines.push(`Labels: ${item.xLabel}, ${item.yLabel}`);
}

function appendGraphPlot(lines: string[], item: GraphPlotItem): void {
  lines.push('');
  lines.push(`## Graph plot → axes ${item.axesId}`);
  const fn = item.fn;
  lines.push('');
  lines.push(`Py: ${(fn.pyExpr ?? '').trim() || '(empty)'}`);
  if (item.xDomain) {
    const lo = Math.min(item.xDomain[0], item.xDomain[1]);
    const hi = Math.max(item.xDomain[0], item.xDomain[1]);
    lines.push(`x domain: [${lo}, ${hi}]`);
  }
  lines.push(`stroke width: ${item.strokeWidth}`);
}

function appendGraphDot(lines: string[], item: GraphDotItem): void {
  lines.push('');
  lines.push(`## Graph dot → axes ${item.axesId}`);
}

function appendGraphFunctionSeries(
  lines: string[],
  item: GraphFunctionSeriesItem,
): void {
  lines.push('');
  lines.push(`## Function series → axes ${item.axesId}`);
  lines.push('');
  lines.push(`Mode: ${item.mode}, n ∈ [${item.nMin}, ${item.nMax}]`);
  lines.push(`Py: ${(item.pyExpr ?? '').trim() || '(empty)'}`);
}

function appendShape(lines: string[], item: ShapeItem): void {
  lines.push('');
  lines.push(`## Shape (${item.shapeType})`);
}

function appendGraphArea(lines: string[], item: GraphAreaItem): void {
  lines.push('');
  lines.push(`## Graph area → axes ${item.axesId}`);
  lines.push(`Mode: ${item.mode.areaKind}`);
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
    else if (it.kind === 'graphFunctionSeries')
      appendGraphFunctionSeries(parts, it);
    else if (it.kind === 'graphArea') appendGraphArea(parts, it);
    else if (it.kind === 'shape') appendShape(parts, it);
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
