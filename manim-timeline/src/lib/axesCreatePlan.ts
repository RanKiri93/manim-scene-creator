import type { AudioTrackItem, AxesItem, ItemId, SceneItem } from '@/types/scene';
import { clipAnimationWindow, clipWindowAlpha } from '@/lib/clipWindows';
import { createProgress } from '@/lib/createPlaybackPreview';

/**
 * How Manim draws an exported axes, so the canvas preview can draw it the same way.
 *
 * Export plays `Create(axes)` where the axis labels are submobjects of the axes
 * (`generateAxesDef`). `Create` has `lag_ratio=1`: every family member with points gets an
 * equal, back-to-back slice of the run time, each eased with `smooth` on its own. Family order
 * (Manim 0.20.1, measured): x line, x tip, x ticks left to right, x number glyphs, y line,
 * y tip, y ticks bottom to top, y number glyphs, x label glyphs, y label glyphs.
 */

/** Manim `smooth` rate function (sigmoid, inflection 10). */
export function manimSmooth(t: number): number {
  const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
  const error = sigmoid(-5);
  const v = (sigmoid(10 * (t - 0.5)) - error) / (1 - 2 * error);
  return Math.max(0, Math.min(1, v));
}

/** numpy `arange(start, stop, step)`. */
function arange(start: number, stop: number, step: number): number[] {
  const n = Math.max(0, Math.ceil((stop - start) / step));
  const out: number[] = [];
  for (let i = 0; i < n && i < 500; i++) out.push(start + i * step);
  return out;
}

const tidy = (v: number) => Number(v.toFixed(10));

/**
 * Tick values of one linear Manim `Axes` axis (`NumberLine.get_tick_range`): the origin tick
 * is excluded, and with a tip the `max` end is excluded too. Numbers sit on the same values.
 */
export function manimAxisTickValues(
  range: readonly [number, number, number],
  includeTip: boolean,
): number[] {
  const [min, rawMax, step] = range;
  if (!(step > 0) || !(rawMax > min)) return [];
  const max = includeTip ? rawMax : rawMax + 1e-6;
  if ((min < max && max < 0) || (max > min && min > 0)) {
    return arange(min, max, step).map(tidy);
  }
  const neg = arange(step, Math.abs(min) + 1e-6, step).map((v) => -v);
  const pos = arange(step, max, step);
  return [...new Set([...neg, ...pos].map(tidy))].sort((a, b) => a - b);
}

/** Text of a Manim axis number (`DecimalNumber`, places from the step as in `NumberLine`). */
export function manimAxisNumberText(value: number, step: number): string {
  const s = String(step);
  const places = s.includes('.') ? s.split('.')[1]!.length : 0;
  return value.toFixed(places);
}

/** Rough glyph count of a `HebrewMathLine` label: `\cmd` is one glyph, markup is none. */
export function estimateLabelGlyphs(src: string): number {
  const s = src.replace(/\\[a-zA-Z]+/g, '#').replace(/\\./g, '#').replace(/[\s${}^_&~]/g, '');
  return Math.max(1, s.length);
}

export type AxesCreatePartRole =
  | 'xLine'
  | 'xTip'
  | 'xTick'
  | 'xNumber'
  | 'yLine'
  | 'yTip'
  | 'yTick'
  | 'yNumber'
  | 'xLabel'
  | 'yLabel';

/** One drawable piece of the axes and the family members (glyphs) it spans. */
export interface AxesCreatePart {
  role: AxesCreatePartRole;
  /** Tick / number index along its axis; 0 otherwise. */
  index: number;
  /** First family-member slot. */
  first: number;
  /** Family members in this part (glyph count for text). */
  count: number;
}

export interface AxesCreatePlan {
  parts: AxesCreatePart[];
  /** Total family members with points: the number of equal `Create` slices. */
  members: number;
  xTicks: number[];
  yTicks: number[];
  xNumbers: string[];
  yNumbers: string[];
  xLabel: string;
  yLabel: string;
}

export function axesCreatePlan(axes: AxesItem): AxesCreatePlan {
  const tip = !!axes.includeTip;
  const xTicks = manimAxisTickValues(axes.xRange, tip);
  const yTicks = manimAxisTickValues(axes.yRange, tip);
  const xNumbers = axes.includeNumbers ? xTicks.map((v) => manimAxisNumberText(v, axes.xRange[2])) : [];
  const yNumbers = axes.includeNumbers ? yTicks.map((v) => manimAxisNumberText(v, axes.yRange[2])) : [];
  const xLabel = typeof axes.xLabel === 'string' ? axes.xLabel.trim() : '';
  const yLabel = typeof axes.yLabel === 'string' ? axes.yLabel.trim() : '';

  const parts: AxesCreatePart[] = [];
  let next = 0;
  const push = (role: AxesCreatePartRole, index: number, count: number) => {
    parts.push({ role, index, first: next, count });
    next += count;
  };
  const axis = (p: 'x' | 'y', ticks: number[], numbers: string[]) => {
    push(`${p}Line`, 0, 1);
    if (tip) push(`${p}Tip`, 0, 1);
    ticks.forEach((_, i) => push(`${p}Tick`, i, 1));
    numbers.forEach((text, i) => push(`${p}Number`, i, Math.max(1, text.length)));
  };
  axis('x', xTicks, xNumbers);
  axis('y', yTicks, yNumbers);
  if (xLabel) push('xLabel', 0, estimateLabelGlyphs(xLabel));
  if (yLabel) push('yLabel', 0, estimateLabelGlyphs(yLabel));
  return { parts, members: next, xTicks, yTicks, xNumbers, yNumbers, xLabel, yLabel };
}

/**
 * Drawn fraction (0..1) of one part at overall `Create` progress `alpha` (linear in time). A
 * multi-glyph part reports the mean of its glyphs, since the canvas draws it as one text.
 */
export function axesCreatePartProgress(part: AxesCreatePart, members: number, alpha: number): number {
  if (alpha >= 1) return 1;
  if (alpha <= 0 || members <= 0) return 0;
  const value = alpha * members;
  let sum = 0;
  for (let m = part.first; m < part.first + part.count; m++) {
    sum += manimSmooth(Math.max(0, Math.min(1, value - m)));
  }
  return sum / part.count;
}

/**
 * Overall `Create` progress (linear in scene time) over the axes' animation window:
 * the bound-narration run time when one resolves, otherwise the clip duration.
 */
export function axesCreateAlpha(
  axes: AxesItem,
  time: number,
  items: Map<ItemId, SceneItem>,
  audioItems?: AudioTrackItem[],
): number {
  if (!clipAnimationWindow(axes, items, audioItems)) return createProgress(axes, time, items);
  return clipWindowAlpha(axes, time, items, audioItems);
}
