import type {
  AudioTrackItem,
  BlinkAnimationItem,
  ItemId,
  MatrixCell,
  MatrixItem,
  MatrixMeasure,
  MatrixStepSpec,
  SceneItem,
  SegmentLocalBox,
} from '@/types/scene';
import { isVisibleAtSceneStartItem } from '@/types/scene';
import { effectiveStart } from '@/lib/time';
import { cellColorAt, cellKey, matrixCellsFor, matrixCols, matrixRows } from '@/lib/matrix';
import {
  MATRIX_SWAP_ARC,
  colorClipOn,
  colorClipsInState,
  matrixColorClips,
  matrixStateColors,
  matrixStateIndexAt,
  matrixStates,
  matrixViewAt,
  stepSource,
  type MatrixColors,
} from '@/lib/matrixSteps';
import { manimSmoothProgress, previewRunTime } from '@/lib/visualPlaybackPreview';

/**
 * Canvas state of a matrix at a moment, mirroring the export (`matrixCodegen`): how far each
 * piece (the brackets + bar "frame", each entry) has appeared, which colours have been laid over
 * it by colour clips and blinks, and which entries a blink is scaling.
 */

/** `LaggedStart` lag of the row / column / entry intros (export uses the same). */
export const MATRIX_INTRO_LAG = 0.6;

/** Reveal of one piece: `opacity` (fade) and `wipe` (Write, left to right), both 0–1. */
export interface PieceReveal {
  opacity: number;
  wipe: number;
}

export interface MatrixIntroState {
  frame: PieceReveal;
  /** By `cellKey`; entries missing here are fully shown. */
  cells: Map<string, PieceReveal>;
}

const SHOWN: PieceReveal = { opacity: 1, wipe: 1 };
const HIDDEN: PieceReveal = { opacity: 0, wipe: 0 };

/** True when the matrix has brackets or an augment bar (the export fades them in first). */
export function matrixHasFrame(item: MatrixItem): boolean {
  const cols = matrixCols(item);
  return item.bracket !== 'none' || (item.augmentCol != null && item.augmentCol > 0 && item.augmentCol < cols);
}

/** Entry groups the intro writes one after another (non-empty entries only), in export order. */
export function matrixIntroGroups(item: MatrixItem, geom: MatrixMeasure): MatrixCell[][] {
  const filled = new Set(geom.cells.map(cellKey));
  const rows = matrixRows(item);
  const cols = matrixCols(item);
  const keep = (cells: MatrixCell[]) => cells.filter((c) => filled.has(cellKey(c)));
  let groups: MatrixCell[][];
  switch (item.introStyle) {
    case 'rows':
      groups = Array.from({ length: rows }, (_, i) => keep(Array.from({ length: cols }, (_, j) => ({ row: i, col: j }))));
      break;
    case 'columns':
      groups = Array.from({ length: cols }, (_, j) => keep(Array.from({ length: rows }, (_, i) => ({ row: i, col: j }))));
      break;
    case 'entries':
      groups = keep(Array.from({ length: rows * cols }, (_, k) => ({ row: Math.floor(k / cols), col: k % cols }))).map((c) => [c]);
      break;
    default:
      return [];
  }
  return groups.filter((g) => g.length > 0);
}

/**
 * Progress (0–1) of animation `k` of `n` in a `LaggedStart(..., lag_ratio)` whose sub-animations
 * all have run time 1, at overall progress `p` (Manim stretches the group to the clip's run time).
 */
export function laggedProgress(p: number, k: number, n: number, lag = MATRIX_INTRO_LAG): number {
  const span = 1 + lag * (n - 1);
  const local = p * span - k * lag;
  return Math.max(0, Math.min(1, local));
}

/** How much of each piece is on screen at `time` (intro only; exits are applied by the wrapper). */
export function matrixIntroState(
  item: MatrixItem,
  geom: MatrixMeasure,
  time: number,
  items: Map<ItemId, SceneItem>,
  audioItems?: AudioTrackItem[],
): MatrixIntroState {
  const t0 = effectiveStart(item, items);
  const all = (r: PieceReveal): MatrixIntroState => ({ frame: r, cells: new Map(geom.cells.map((c) => [cellKey(c), r])) });
  if (time < t0) return all(HIDDEN);
  if (isVisibleAtSceneStartItem(item)) return all(SHOWN);
  const dur = previewRunTime(item, items, audioItems);
  const p = !(dur > 0) || time >= t0 + dur ? 1 : (time - t0) / dur;
  if (p >= 1) return all(SHOWN);
  if (item.introStyle === 'write') return all({ opacity: 1, wipe: p });
  if (item.introStyle === 'fade_in') return all({ opacity: manimSmoothProgress(p), wipe: 1 });

  const groups = matrixIntroGroups(item, geom);
  const hasFrame = matrixHasFrame(item);
  const n = groups.length + (hasFrame ? 1 : 0);
  const cells = new Map<string, PieceReveal>();
  groups.forEach((g, gi) => {
    const local = laggedProgress(p, gi + (hasFrame ? 1 : 0), n);
    for (const c of g) cells.set(cellKey(c), { opacity: local > 0 ? 1 : 0, wipe: local });
  });
  const frame = hasFrame ? { opacity: manimSmoothProgress(laggedProgress(p, 0, n)), wipe: 1 } : SHOWN;
  return { frame, cells };
}

/** A colour laid over a piece at an opacity (later layers on top). */
export interface ColorLayer {
  color: string;
  opacity: number;
}

/** Colour layers per piece: the brackets and bar (`frame`) and each entry (by `cellKey`). */
export interface PieceColorLayers {
  frame: ColorLayer[];
  cells: Map<string, ColorLayer[]>;
}

export interface MatrixColorState extends PieceColorLayers {
  /** Entries a blink is scaling (about their common centre) by `scale`; null when none. */
  blinkScale: { cells: MatrixCell[]; scale: number } | null;
  /** After a step: the colours of the state it started from, over that state's preview. */
  previous: PieceColorLayers | null;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

const BLINK_DEFAULT_COLOR = '#fbbf24';

function layerList(view: MatrixItem): { layers: PieceColorLayers; push: (keys: string[] | null, layer: ColorLayer) => void } {
  const layers: PieceColorLayers = { frame: [], cells: new Map() };
  const allKeys: string[] = [];
  for (let i = 0; i < matrixRows(view); i++) for (let j = 0; j < matrixCols(view); j++) allKeys.push(`${i},${j}`);
  const push = (keys: string[] | null, layer: ColorLayer) => {
    if (layer.opacity <= 1e-4) return;
    if (keys == null) layers.frame.push(layer);
    for (const k of keys ?? allKeys) {
      const list = layers.cells.get(k) ?? [];
      list.push(layer);
      layers.cells.set(k, list);
    }
  };
  return { layers, push };
}

/**
 * Layers that turn a state's typeset preview into `colors`. The first state's preview already
 * has the matrix's entry colours; after a step the preview is typeset in the matrix colour.
 */
function tintsOver(item: MatrixItem, stateIndex: number, colors: MatrixColors): PieceColorLayers {
  const layers: PieceColorLayers = { frame: [], cells: new Map() };
  if (colors.frame !== item.color) layers.frame.push({ color: colors.frame, opacity: 1 });
  for (const [key, color] of colors.cells) {
    const [i, j] = key.split(',').map(Number) as [number, number];
    const baked = stateIndex === 0 ? cellColorAt(item, i, j) : item.color;
    if (color !== baked) layers.cells.set(key, [{ color, opacity: 1 }]);
  }
  return layers;
}

/**
 * Colour clips (`target_animation` colour) and the active blink on this matrix at `time`, as
 * colour layers per piece of the state shown then. A clip on the whole matrix recolours every
 * piece; with `cells`, only those entries. After a step, the colours its entries carried over
 * come first.
 */
export function matrixColorState(item: MatrixItem, time: number, items: Map<ItemId, SceneItem>): MatrixColorState {
  const states = matrixStates(item, items);
  const k = matrixStateIndexAt(states, time);
  const view = states[k]!.view;
  const colors = k > 0 ? matrixStateColors(item, items, states) : null;
  const { layers, push } = layerList(view);
  if (colors) {
    const base = tintsOver(item, k, colors[k]!.start);
    layers.frame.push(...base.frame);
    for (const [key, list] of base.cells) layers.cells.set(key, [...list]);
  }

  for (const clip of colorClipsInState(states, k, matrixColorClips(item.id, items))) {
    if (time < clip.startTime) continue;
    const u = clamp01((time - clip.startTime) / Math.max(0.01, clip.duration));
    const { color, cells } = colorClipOn(clip, item.id, view);
    push(cells.length ? cells.map(cellKey) : null, { color, opacity: manimSmoothProgress(u) });
  }

  let blinkScale: MatrixColorState['blinkScale'] = null;
  const blink = activeBlink(item.id, time, items);
  if (blink) {
    const { row, envelope } = blink;
    const sel = matrixCellsFor(view, row.cells);
    if (row.mode === 'color') {
      push(sel.length ? sel.map(cellKey) : null, { color: row.blinkColor?.trim() || BLINK_DEFAULT_COLOR, opacity: envelope });
    } else if (sel.length) {
      const sf = typeof row.scaleFactor === 'number' && row.scaleFactor > 1e-6 ? row.scaleFactor : 1.15;
      blinkScale = { cells: sel, scale: 1 + (sf - 1) * envelope };
    }
  }
  const previous = colors ? tintsOver(item, k - 1, colors[k - 1]!.end) : null;
  return { ...layers, blinkScale, previous };
}

function activeBlink(
  targetId: ItemId,
  time: number,
  items: Map<ItemId, SceneItem>,
): { row: BlinkAnimationItem['targets'][number]; envelope: number } | null {
  let best: { row: BlinkAnimationItem['targets'][number]; envelope: number; start: number } | null = null;
  for (const it of items.values()) {
    if (it.kind !== 'blink_animation') continue;
    const row = it.targets.find((r) => r.targetId === targetId);
    if (!row) continue;
    const dur = Math.max(0.05, it.duration);
    if (time < it.startTime || time >= it.startTime + dur) continue;
    if (best && it.startTime < best.start) continue;
    const reps = Math.max(1, Math.round(it.repetitions) || 1);
    const cycle = dur / reps;
    const u = ((time - it.startTime) % cycle) / cycle;
    best = { row, envelope: u < 0.5 ? u * 2 : (1 - u) * 2, start: it.startTime };
  }
  return best ? { row: best.row, envelope: best.envelope } : null;
}

/**
 * Colours of the brackets / bar and of each entry once every colour clip that starts before
 * `time` has played (what a blink starting at `time` restores to), in the state shown then.
 */
export function matrixColorsBefore(
  item: MatrixItem,
  time: number,
  items: Map<ItemId, SceneItem>,
): { frame: string; cell: (row: number, col: number) => string } {
  const states = matrixStates(item, items);
  const k = matrixStateIndexAt(states, time);
  const view = states[k]!.view;
  const start = matrixStateColors(item, items, states)[k]!.start;
  let frame = start.frame;
  const own = new Map(start.cells);
  for (const clip of colorClipsInState(states, k, matrixColorClips(item.id, items))) {
    if (clip.startTime >= time) continue;
    const { color, cells } = colorClipOn(clip, item.id, view);
    if (cells.length === 0) frame = color;
    for (const key of cells.length ? cells.map(cellKey) : [...own.keys()]) own.set(key, color);
  }
  return { frame, cell: (row, col) => own.get(`${row},${col}`) ?? item.color };
}

/** True when a blink on this matrix targets only some entries (so the canvas scales those, not the node). */
export function matrixBlinkIsPartial(item: MatrixItem, time: number, items: Map<ItemId, SceneItem>): boolean {
  const b = activeBlink(item.id, time, items);
  return !!b && matrixCellsFor(matrixViewAt(item, items, time), b.row.cells).length > 0;
}

// ── A step playing ──

/** Which piece of a state's typeset preview: an entry, a bracket or the bar. */
export type MatrixPieceRef = { cell: MatrixCell } | { frame: 'lb' | 'rb' | 'bar' };

/** One piece drawn while a step plays. */
export interface StepPiece {
  key: string;
  /** Cropped from the preview of the state before the step, or of the state after it. */
  from: 'prev' | 'cur';
  ref: MatrixPieceRef;
  /** The piece's box in its own state (matrix centred at the origin). */
  crop: SegmentLocalBox;
  /** Where it is drawn now. */
  box: SegmentLocalBox;
  opacity: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpBox(a: SegmentLocalBox, b: SegmentLocalBox, t: number): SegmentLocalBox {
  return { cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) };
}

/** Manim's `path_along_arc(angle)` for one point, from `a` to `b` at `t`. */
export function arcPoint(a: { x: number; y: number }, b: { x: number; y: number }, angle: number, t: number): { x: number; y: number } {
  if (Math.abs(angle) < 0.01) return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const k = Math.abs(angle - Math.PI) < 1e-9 ? 0 : 1 / Math.tan(angle / 2);
  const cx = a.x + vx / 2 - (vy / 2) * k;
  const cy = a.y + vy / 2 + (vx / 2) * k;
  const th = angle * t;
  const dx = a.x - cx;
  const dy = a.y - cy;
  return { x: cx + dx * Math.cos(th) - dy * Math.sin(th), y: cy + dx * Math.sin(th) + dy * Math.cos(th) };
}

/**
 * Pieces of a matrix part-way (`progress` 0–1) through a step, as `MatrixStep` animates them:
 * an entry whose text is unchanged moves to its new place (swapped rows on arcs), a changed
 * entry cross-fades into the new one while both stretch from the old place to the new, entries
 * with nowhere to go fade out, and brackets and bar move with the new size (cross-fading when
 * their height changes, as taller brackets are built from other glyph pieces).
 */
export function matrixStepPieces(
  spec: MatrixStepSpec,
  prevView: MatrixItem,
  prevGeom: MatrixMeasure,
  curView: MatrixItem,
  curGeom: MatrixMeasure,
  progress: number,
): StepPiece[] {
  const s = manimSmoothProgress(progress);
  const out: StepPiece[] = [];
  const prevRows = matrixRows(prevView);
  const prevCols = matrixCols(prevView);
  const prevBox = new Map(prevGeom.cells.map((c) => [cellKey(c), c]));
  const curBox = new Map(curGeom.cells.map((c) => [cellKey(c), c]));
  const used = new Set<string>();
  for (let i = 0; i < matrixRows(curView); i++) {
    for (let j = 0; j < matrixCols(curView); j++) {
      const key = `${i},${j}`;
      const src = stepSource(spec, i, j, prevRows, prevCols);
      if (src) used.add(cellKey(src));
      const oldB = src ? prevBox.get(cellKey(src)) ?? null : null;
      const newB = curBox.get(key) ?? null;
      if (oldB && newB && src && prevView.entries[src.row]![src.col]!.trim() === curView.entries[i]![j]!.trim()) {
        const arc = spec.op === 'swap_rows' && src.row !== i ? MATRIX_SWAP_ARC : 0;
        const p = arcPoint({ x: oldB.cx, y: oldB.cy }, { x: newB.cx, y: newB.cy }, arc, s);
        out.push({ key: `c${key}`, from: 'cur', ref: { cell: { row: i, col: j } }, crop: newB, box: { cx: p.x, cy: p.y, w: lerp(oldB.w, newB.w, s), h: lerp(oldB.h, newB.h, s) }, opacity: 1 });
        continue;
      }
      if (oldB && src) {
        out.push({ key: `p${cellKey(src)}`, from: 'prev', ref: { cell: src }, crop: oldB, box: lerpBox(oldB, newB ?? oldB, s), opacity: 1 - s });
      }
      if (newB) {
        out.push({ key: `c${key}`, from: 'cur', ref: { cell: { row: i, col: j } }, crop: newB, box: lerpBox(oldB ?? newB, newB, s), opacity: s });
      }
    }
  }
  for (const b of prevGeom.cells) {
    const key = cellKey(b);
    if (!used.has(key)) out.push({ key: `p${key}`, from: 'prev', ref: { cell: { row: b.row, col: b.col } }, crop: b, box: b, opacity: 1 - s });
  }
  const frame: ['lb' | 'rb' | 'bar', SegmentLocalBox | null, SegmentLocalBox | null][] = [
    ['lb', prevGeom.leftBracket, curGeom.leftBracket],
    ['rb', prevGeom.rightBracket, curGeom.rightBracket],
    ['bar', prevGeom.bar, curGeom.bar],
  ];
  for (const [name, oldB, newB] of frame) {
    if (oldB && newB) {
      if (Math.abs(newB.h - oldB.h) <= 0.02 * Math.max(oldB.h, 1e-6)) {
        out.push({ key: `c${name}`, from: 'cur', ref: { frame: name }, crop: newB, box: lerpBox(oldB, newB, s), opacity: 1 });
      } else {
        const cx = lerp(oldB.cx, newB.cx, s);
        const cy = lerp(oldB.cy, newB.cy, s);
        out.push({ key: `p${name}`, from: 'prev', ref: { frame: name }, crop: oldB, box: { cx, cy, w: oldB.w, h: oldB.h }, opacity: 1 - s });
        out.push({ key: `c${name}`, from: 'cur', ref: { frame: name }, crop: newB, box: { cx, cy, w: newB.w, h: newB.h }, opacity: s });
      }
    } else if (oldB) {
      out.push({ key: `p${name}`, from: 'prev', ref: { frame: name }, crop: oldB, box: oldB, opacity: 1 - s });
    } else if (newB) {
      out.push({ key: `c${name}`, from: 'cur', ref: { frame: name }, crop: newB, box: newB, opacity: s });
    }
  }
  return out.filter((p) => p.opacity > 1e-4);
}
