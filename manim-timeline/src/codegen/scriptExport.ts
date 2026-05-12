import type {
  SceneItem,
  TextLineItem,
  AxesItem,
  GraphPlotItem,
  GraphCurveItem,
  GraphDotItem,
  GraphFieldItem,
  GraphFunctionSeriesItem,
  GraphPointSequenceItem,
  GraphAreaItem,
  ShapeItem,
  ItemId,
  AudioTrackItem,
} from '@/types/scene';
import { isTopLevelItem, effectiveStart, runDuration } from '@/lib/time';
import { explicitVisualOwnerForAudioTrack } from '@/lib/audioBinding';
import { itemClipDisplayName } from '@/lib/itemDisplayName';

export type SceneState = {
  items: Map<ItemId, SceneItem>;
};

const GENERIC_AUDIO_LABELS = new Set([
  'uploaded audio',
  'mic recording',
  '',
]);

function needsScriptReview(text: string): boolean {
  const t = text.trim();
  return GENERIC_AUDIO_LABELS.has(t.toLowerCase());
}

type AudioScriptSortRow =
  | {
      kind: 'audio';
      start: number;
      id: string;
      track: AudioTrackItem;
    }
  | {
      kind: 'textLine';
      start: number;
      id: string;
      line: TextLineItem;
    };

/** Pure Markdown body for narration / recording prep (tests + preview). */
export function buildAudioScriptMarkdown(
  items: Map<ItemId, SceneItem>,
  audioItems: readonly AudioTrackItem[],
): string {
  const rows: AudioScriptSortRow[] = [];

  for (const t of audioItems) {
    rows.push({
      kind: 'audio',
      start: t.startTime,
      id: t.id,
      track: t,
    });
  }

  for (const it of items.values()) {
    if (!isTopLevelItem(it)) continue;
    if (it.kind !== 'textLine') continue;
    rows.push({
      kind: 'textLine',
      start: effectiveStart(it, items),
      id: it.id,
      line: it,
    });
  }

  rows.sort((a, b) => {
    const d = a.start - b.start;
    if (Math.abs(d) > 1e-9) return d;
    const kindOrder = a.kind === 'audio' ? 0 : 1;
    const kindOrderB = b.kind === 'audio' ? 0 : 1;
    if (kindOrder !== kindOrderB) return kindOrder - kindOrderB;
    return a.id.localeCompare(b.id);
  });

  let audioN = 0;
  let lineN = 0;
  const parts: string[] = [
    '# Audio Script',
    '',
    'Timeline order; use this for external recording/editing.',
    '',
  ];

  for (const row of rows) {
    if (row.kind === 'audio') {
      audioN += 1;
      const track = row.track;
      parts.push(`## Audio ${audioN}`);
      parts.push('');
      parts.push(`- **Start:** ${row.start.toFixed(2)}s`);
      parts.push(`- **Duration:** ${track.duration.toFixed(2)}s`);
      parts.push(`- **Track id:** \`${track.id}\``);
      const owner = explicitVisualOwnerForAudioTrack(items, track.id);
      if (owner) {
        parts.push(`- **Bound clip:** ${itemClipDisplayName(owner)}`);
      }
      parts.push('');
      const raw = track.text ?? '';
      if (needsScriptReview(raw)) {
        parts.push(
          '_Review: replace generic or empty script text with your narration._',
        );
        parts.push('');
      }
      parts.push(raw.trim() || '_(no script text on this track)_');
      parts.push('');
    } else {
      lineN += 1;
      const line = row.line;
      const dur = runDuration(line, items);
      parts.push(`## Text line ${lineN}`);
      parts.push('');
      parts.push(`- **Start:** ${row.start.toFixed(2)}s`);
      parts.push(
        `- **Duration:** ${dur.toFixed(2)}s (timeline run segment — anim + segment waits)`,
      );
      parts.push(`- **Clip:** ${itemClipDisplayName(line)}`);
      parts.push(`- **Item id:** \`${line.id}\``);
      parts.push('');
      parts.push(line.raw?.trim() || '_(empty raw)_');
      parts.push('');
    }
  }

  if (rows.length === 0) {
    parts.push('_No audio tracks and no text lines in this scene._');
    parts.push('');
  }

  return parts.join('\n').replace(/\n+$/, '') + '\n';
}

export function exportAudioScriptToMarkdown(state: {
  items: Map<ItemId, SceneItem>;
  audioItems: AudioTrackItem[];
}): void {
  const md = buildAudioScriptMarkdown(state.items, state.audioItems);
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'audio_script.md';
  a.rel = 'noopener';
  a.click();
  URL.revokeObjectURL(url);
}

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

function appendGraphCurve(lines: string[], item: GraphCurveItem): void {
  lines.push('');
  lines.push(`## Graph curve → axes ${item.axesId}`);
  lines.push('');
  const c = item.curve;
  lines.push(`x(t) Py: ${(c.pyXExpr ?? '').trim() || '(empty)'}`);
  lines.push(`y(t) Py: ${(c.pyYExpr ?? '').trim() || '(empty)'}`);
  const lo = Math.min(item.tDomain[0], item.tDomain[1]);
  const hi = Math.max(item.tDomain[0], item.tDomain[1]);
  lines.push(`t domain: [${lo}, ${hi}]`);
  lines.push(`stroke width: ${item.strokeWidth}`);
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

function appendGraphPointSequence(
  lines: string[],
  item: GraphPointSequenceItem,
): void {
  lines.push('');
  lines.push(`## Point sequence → axes ${item.axesId}`);
  lines.push('');
  lines.push(`Mode: ${item.mode}, n ∈ [${item.nMin}, ${item.nMax}]`);
  lines.push(`x(n) Py: ${(item.pyXExpr ?? '').trim() || '(empty)'}`);
  lines.push(`y(n) Py: ${(item.pyYExpr ?? '').trim() || '(empty)'}`);
}

function appendShape(lines: string[], item: ShapeItem): void {
  lines.push('');
  lines.push(`## Shape (${item.shapeType})`);
  if (item.shapeType === 'polyline') {
    lines.push(
      `points: ${item.points.map((p) => `(${p.x}, ${p.y})`).join(' -> ')}`,
    );
    lines.push(
      `arrowheads: ${item.tailArrow && item.headArrow ? 'both' : item.tailArrow ? 'tail' : item.headArrow ? 'head' : 'none'}`,
    );
  }
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
  if (typeof item.arrowStrokeWidth === 'number') {
    lines.push(`Arrow stroke width (px): ${item.arrowStrokeWidth}`);
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
    else if (it.kind === 'graphCurve') appendGraphCurve(parts, it);
    else if (it.kind === 'graphDot') appendGraphDot(parts, it);
    else if (it.kind === 'graphField') appendGraphField(parts, it);
    else if (it.kind === 'graphFunctionSeries')
      appendGraphFunctionSeries(parts, it);
    else if (it.kind === 'graphPointSequence')
      appendGraphPointSequence(parts, it);
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
