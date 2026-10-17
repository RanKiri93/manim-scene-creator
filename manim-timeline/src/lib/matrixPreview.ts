import type {
  AudioTrackItem,
  BlinkAnimationItem,
  ItemId,
  MatrixCell,
  MatrixItem,
  MatrixMeasure,
  SceneItem,
  TargetAnimationItem,
} from '@/types/scene';
import { isVisibleAtSceneStartItem } from '@/types/scene';
import { effectiveStart } from '@/lib/time';
import { cellColorAt, cellKey, matrixCellsFor, matrixCols, matrixRows } from '@/lib/matrix';
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

export interface MatrixColorState {
  frame: ColorLayer[];
  /** By `cellKey`. */
  cells: Map<string, ColorLayer[]>;
  /** Entries a blink is scaling (about their common centre) by `scale`; null when none. */
  blinkScale: { cells: MatrixCell[]; scale: number } | null;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

const TA_DEFAULT_COLOR = '#38bdf8';
const BLINK_DEFAULT_COLOR = '#fbbf24';

/**
 * Colour clips (`target_animation` colour) and the active blink on this matrix at `time`, as
 * colour layers per piece. A clip on the whole matrix recolours every piece; with `cells`, only
 * those entries.
 */
export function matrixColorState(item: MatrixItem, time: number, items: Map<ItemId, SceneItem>): MatrixColorState {
  const frame: ColorLayer[] = [];
  const cells = new Map<string, ColorLayer[]>();
  const push = (keys: string[] | null, layer: ColorLayer) => {
    if (layer.opacity <= 1e-4) return;
    if (keys == null) frame.push(layer);
    for (const k of keys ?? [...allKeys]) {
      const list = cells.get(k) ?? [];
      list.push(layer);
      cells.set(k, list);
    }
  };
  const allKeys = new Set<string>();
  for (let i = 0; i < matrixRows(item); i++) for (let j = 0; j < matrixCols(item); j++) allKeys.add(`${i},${j}`);

  const colorClips = [...items.values()]
    .filter((it): it is TargetAnimationItem => it.kind === 'target_animation' && it.mode === 'color')
    .filter((c) => c.targets.some((r) => r.targetId === item.id))
    .sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
  for (const clip of colorClips) {
    if (time < clip.startTime) continue;
    const row = clip.targets.find((r) => r.targetId === item.id)!;
    const dur = Math.max(0.01, clip.duration);
    const u = clamp01((time - clip.startTime) / dur);
    const h = row.color?.trim() && /^#[0-9a-fA-F]{6}$/.test(row.color.trim()) ? row.color.trim() : TA_DEFAULT_COLOR;
    const sel = matrixCellsFor(item, row.cells);
    push(sel.length ? sel.map(cellKey) : null, { color: h, opacity: manimSmoothProgress(u) });
  }

  let blinkScale: MatrixColorState['blinkScale'] = null;
  const blink = activeBlink(item.id, time, items);
  if (blink) {
    const { row, envelope } = blink;
    const sel = matrixCellsFor(item, row.cells);
    if (row.mode === 'color') {
      push(sel.length ? sel.map(cellKey) : null, { color: row.blinkColor?.trim() || BLINK_DEFAULT_COLOR, opacity: envelope });
    } else if (sel.length) {
      const sf = typeof row.scaleFactor === 'number' && row.scaleFactor > 1e-6 ? row.scaleFactor : 1.15;
      blinkScale = { cells: sel, scale: 1 + (sf - 1) * envelope };
    }
  }
  return { frame, cells, blinkScale };
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
 * `time` has played (what a blink starting at `time` restores to).
 */
export function matrixColorsBefore(
  item: MatrixItem,
  time: number,
  items: Map<ItemId, SceneItem>,
): { frame: string; cell: (row: number, col: number) => string } {
  let frame = item.color;
  const own = new Map<string, string>();
  for (let i = 0; i < matrixRows(item); i++) for (let j = 0; j < matrixCols(item); j++) own.set(`${i},${j}`, cellColorAt(item, i, j));
  const clips = [...items.values()]
    .filter((it): it is TargetAnimationItem => it.kind === 'target_animation' && it.mode === 'color' && it.startTime < time)
    .filter((c) => c.targets.some((r) => r.targetId === item.id))
    .sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
  for (const clip of clips) {
    const row = clip.targets.find((r) => r.targetId === item.id)!;
    const h = row.color?.trim() && /^#[0-9a-fA-F]{6}$/.test(row.color.trim()) ? row.color.trim() : TA_DEFAULT_COLOR;
    const sel = matrixCellsFor(item, row.cells);
    if (sel.length === 0) frame = h;
    for (const k of sel.length ? sel.map(cellKey) : [...own.keys()]) own.set(k, h);
  }
  return { frame, cell: (row, col) => own.get(`${row},${col}`) ?? item.color };
}

/** True when a blink on this matrix targets only some entries (so the canvas scales those, not the node). */
export function matrixBlinkIsPartial(item: MatrixItem, time: number, items: Map<ItemId, SceneItem>): boolean {
  const b = activeBlink(item.id, time, items);
  return !!b && matrixCellsFor(item, b.row.cells).length > 0;
}
