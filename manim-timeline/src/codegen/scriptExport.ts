import type {
  SceneItem,
  TextLineItem,
  GraphItem,
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

function appendVo(lines: string[], preamble: string, script: string): void {
  const p = preamble?.trim();
  const s = script?.trim();
  if (p) {
    lines.push('');
    lines.push(`**Preamble:** ${p}`);
  }
  if (s) {
    lines.push('');
    lines.push(s);
  }
}

function appendTextLine(lines: string[], item: TextLineItem): void {
  lines.push('');
  lines.push(lineHeading(item.raw ?? ''));
  appendVo(lines, item.voice.preamble, item.voice.script);
}

function appendGraph(lines: string[], item: GraphItem): void {
  lines.push('');
  lines.push(`## Graph ${item.id}`);
  appendVo(lines, item.voice.preamble, item.voice.script);
  const axes = item.voiceAxesScript?.trim();
  const labels = item.voiceLabelsScript?.trim();
  if (axes) {
    lines.push('');
    lines.push('**Axes:**');
    lines.push(axes);
  }
  if (labels) {
    lines.push('');
    lines.push('**Labels:**');
    lines.push(labels);
  }
  for (const fn of item.functions ?? []) {
    const vt = fn.voiceText?.trim();
    if (vt) {
      lines.push('');
      lines.push(`**Function (${fn.label || fn.id}):**`);
      lines.push(vt);
    }
  }
  for (const dot of item.dots ?? []) {
    const vt = dot.voiceText?.trim();
    if (vt) {
      lines.push('');
      lines.push(`**Dot (${dot.label || dot.id}):**`);
      lines.push(vt);
    }
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

  const parts: string[] = ['# Voiceover script', ''];
  for (const it of ordered) {
    if (it.kind === 'textLine') appendTextLine(parts, it);
    else if (it.kind === 'graph') appendGraph(parts, it);
    else if (it.kind === 'compound') appendCompound(parts, it, items);
  }

  const md = parts.join('\n');
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'scene_script.md';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
