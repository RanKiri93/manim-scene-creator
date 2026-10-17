import type {
  ItemId,
  MatrixCell,
  MatrixItem,
  MatrixStepOp,
  MatrixStepSpec,
  SceneItem,
  TargetAnimationItem,
} from '@/types/scene';
import { cellColorAt, cellKey, matrixCols, matrixRows, normalizeCells } from './matrix';

/**
 * Matrix steps (`target_animation` clips with `mode: 'matrix_step'`): the result of each row
 * operation, where every new entry comes from, the operation label, and the matrix's states over
 * time with the colours that travel with its entries. Shared by the editor, the canvas preview
 * and the export (`MatrixStep` in hebrew_matrix.py).
 */

export const MATRIX_STEP_OPS: readonly { id: MatrixStepOp; label: string; hint: string }[] = [
  { id: 'swap_rows', label: 'Swap rows', hint: 'Two rows trade places, swinging past each other.' },
  { id: 'scale_row', label: 'Scale a row', hint: 'Multiply one row by a factor; changed entries cross-fade.' },
  { id: 'add_row', label: 'Add a multiple of a row', hint: 'Add a multiple of one row to another; changed entries cross-fade.' },
  { id: 'edit', label: 'Edit entries', hint: 'Type the new entries; only the ones that change animate.' },
  { id: 'transpose', label: 'Transpose', hint: 'Entry (i, j) moves to (j, i). An augment bar is dropped.' },
];

/** `MatrixStep(swap=...)` path arc (radians) for rows that trade places. */
export const MATRIX_SWAP_ARC = Math.PI / 2;

export type MatrixStepClip = TargetAnimationItem & { mode: 'matrix_step' };

export function isMatrixStepClip(it: SceneItem | undefined | null): it is MatrixStepClip {
  return it?.kind === 'target_animation' && it.mode === 'matrix_step';
}

export function defaultMatrixStepSpec(): MatrixStepSpec {
  return { op: 'swap_rows', row: 0, otherRow: 1, factor: '2', measure: null, previewDataUrl: null };
}

/** The matrix a step clip acts on and its step, or null when the clip is incomplete. */
export function matrixStepOf(clip: TargetAnimationItem): { matrixId: ItemId; spec: MatrixStepSpec } | null {
  if (clip.mode !== 'matrix_step') return null;
  const row = clip.targets[0];
  if (!row?.step) return null;
  return { matrixId: row.targetId, spec: row.step };
}

/** Step clips of a matrix, in the order they play. */
export function matrixStepClips(matrixId: ItemId, items: Map<ItemId, SceneItem>): MatrixStepClip[] {
  return [...items.values()]
    .filter((it): it is MatrixStepClip => isMatrixStepClip(it) && matrixStepOf(it)?.matrixId === matrixId)
    .sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
}

// ── Arithmetic on entries ──

interface Rational {
  n: number;
  d: number;
  /** Written as a decimal (the result is shown as one too). */
  decimal: boolean;
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

function rational(n: number, d: number, decimal: boolean): Rational | null {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || d === 0) return null;
  const g = gcd(n, d);
  const s = d < 0 ? -1 : 1;
  return { n: (s * n) / g, d: (s * d) / g, decimal };
}

/** True for `{...}` where the first brace closes at the very end. */
function wrappedInBraces(s: string): boolean {
  if (!s.startsWith('{') || !s.endsWith('}')) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i === s.length - 1;
  }
  return false;
}

/** A number written as an integer, decimal, `a/b` or `\frac{a}{b}` (with a sign), or null. */
export function parseRational(tex: string): Rational | null {
  let s = tex.trim().replace(/−/g, '-').replace(/\s+/g, '');
  while (wrappedInBraces(s)) s = s.slice(1, -1);
  if (s === '') return null;
  let sign = 1;
  while (/^[+-]/.test(s)) {
    if (s[0] === '-') sign = -sign;
    s = s.slice(1);
  }
  if (/^\d+$/.test(s)) return rational(sign * Number(s), 1, false);
  const dec = /^(\d*)\.(\d+)$|^(\d+)\.$/.exec(s);
  if (dec) {
    const whole = dec[1] ?? dec[3] ?? '';
    const frac = dec[2] ?? '';
    return rational(sign * Number(`${whole || '0'}${frac}`), 10 ** frac.length, true);
  }
  const slash = /^(\d+)\/(\d+)$/.exec(s);
  if (slash) return rational(sign * Number(slash[1]), Number(slash[2]), false);
  const frac = /^\\[dt]?frac\{([+-]?\d+)\}\{([+-]?\d+)\}$/.exec(s) ?? /^\\[dt]?frac(\d)(\d)$/.exec(s);
  if (frac) return rational(sign * Number(frac[1]), Number(frac[2]), false);
  return null;
}

/** LaTeX for a number: `3`, `-\frac{1}{2}`, or a decimal when an input was one. */
export function formatRational(r: Rational): string {
  if (r.d === 1) return String(r.n);
  if (r.decimal) return String(Number((r.n / r.d).toFixed(6)));
  return `${r.n < 0 ? '-' : ''}\\frac{${Math.abs(r.n)}}{${r.d}}`;
}

function mulR(a: Rational, b: Rational): Rational | null {
  const g1 = gcd(a.n, b.d);
  const g2 = gcd(b.n, a.d);
  return rational((a.n / g1) * (b.n / g2), (a.d / g2) * (b.d / g1), a.decimal || b.decimal);
}

function addR(a: Rational, b: Rational): Rational | null {
  const g = gcd(a.d, b.d);
  return rational(a.n * (b.d / g) + b.n * (a.d / g), (a.d / g) * b.d, a.decimal || b.decimal);
}

/** True when `tex` is a sum or difference at the top level (so it needs brackets in a product). */
function isSum(tex: string): boolean {
  let depth = 0;
  const s = tex.trim();
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') depth--;
    else if (ch === '\\') {
      const cmd = /^\\(left|right|[a-zA-Z]+|.)/.exec(s.slice(i))?.[0] ?? '\\';
      if (cmd === '\\pm' || cmd === '\\mp') {
        if (depth === 0 && i > 0) return true;
      }
      i += cmd.length - 1;
    } else if ((ch === '+' || ch === '-' || ch === '−') && depth === 0 && i > 0 && !/[\^_]/.test(s[i - 1]!)) {
      return true;
    }
  }
  return false;
}

function bracketed(tex: string): string {
  return isSum(tex) ? `\\left(${tex.trim()}\\right)` : tex.trim();
}

function negate(tex: string): string {
  const s = tex.trim();
  const r = parseRational(s);
  if (r) return formatRational({ ...r, n: -r.n });
  if (isSum(s)) return `-\\left(${s}\\right)`;
  if (s.startsWith('-')) return s.slice(1).trim();
  if (s.startsWith('+')) return `-${s.slice(1).trim()}`;
  return `-${s}`;
}

/** `factor · entry`, worked out when both are numbers. */
export function multiplyEntry(factor: string, entry: string): string {
  const e = entry.trim();
  if (e === '') return '';
  const k = parseRational(factor);
  const v = parseRational(e);
  if (k && v) {
    const p = mulR(k, v);
    if (p) return formatRational(p);
  }
  if (v && v.n === 0) return formatRational({ ...v, n: 0, d: 1 });
  if (k) {
    if (k.n === 0) return '0';
    if (k.n === k.d) return e;
    if (k.n === -k.d) return negate(e);
  }
  const f = k ? formatRational(k) : bracketed(factor);
  const body = bracketed(e);
  // `2 3x` would read as 23x; a symbol and a factor written together read as a product.
  const sep = /^[\d.]/.test(body) ? ' \\cdot ' : ' ';
  return `${f}${sep}${body}`;
}

/** `entry + term`, worked out when both are numbers. */
export function addEntries(entry: string, term: string): string {
  const a = entry.trim();
  const b = term.trim();
  if (b === '') return a;
  if (a === '') return b;
  const ra = parseRational(a);
  const rb = parseRational(b);
  if (ra && rb) {
    const s = addR(ra, rb);
    if (s) return formatRational(s);
  }
  if (rb && rb.n === 0) return a;
  if (ra && ra.n === 0) return b;
  if (b.startsWith('-') && !isSum(b.slice(1))) return `${a} - ${b.slice(1).trim()}`;
  return `${a} + ${b}`;
}

function copyEntries(entries: readonly (readonly string[])[]): string[][] {
  return entries.map((r) => [...r]);
}

function rowsValid(spec: MatrixStepSpec, rows: number, both: boolean): boolean {
  const ok = (r: number) => Number.isInteger(r) && r >= 0 && r < rows;
  return ok(spec.row) && (!both || (ok(spec.otherRow) && spec.otherRow !== spec.row));
}

/** The result of the operation on `before` (ignores a result typed by hand). */
export function computeStepEntries(before: readonly (readonly string[])[], spec: MatrixStepSpec): string[][] {
  const out = copyEntries(before);
  const rows = out.length;
  switch (spec.op) {
    case 'swap_rows':
      if (rowsValid(spec, rows, true)) [out[spec.row], out[spec.otherRow]] = [out[spec.otherRow]!, out[spec.row]!];
      return out;
    case 'scale_row':
      if (rowsValid(spec, rows, false)) out[spec.row] = out[spec.row]!.map((e) => multiplyEntry(spec.factor, e));
      return out;
    case 'add_row':
      if (rowsValid(spec, rows, true)) {
        const src = out[spec.otherRow]!;
        out[spec.row] = out[spec.row]!.map((e, j) => addEntries(e, multiplyEntry(spec.factor, src[j] ?? '')));
      }
      return out;
    case 'transpose': {
      const cols = out[0]?.length ?? 0;
      return Array.from({ length: cols }, (_, j) => Array.from({ length: rows }, (_, i) => out[i]![j] ?? ''));
    }
    case 'edit':
      return out;
  }
}

/** True when the step's result was typed by hand. */
export function stepIsManual(spec: MatrixStepSpec): boolean {
  return spec.op !== 'transpose' && Array.isArray(spec.entries) && spec.entries.length > 0;
}

/** The entries after the step: typed by hand, or worked out from the operation. */
export function stepResultEntries(before: readonly (readonly string[])[], spec: MatrixStepSpec): string[][] {
  return stepIsManual(spec) ? copyEntries(spec.entries!) : computeStepEntries(before, spec);
}

/** True when a hand-typed result was made from entries other than the current ones before it. */
export function stepBasisChanged(before: readonly (readonly string[])[], spec: MatrixStepSpec): boolean {
  if (!stepIsManual(spec) || !spec.basis) return false;
  return JSON.stringify(spec.basis) !== JSON.stringify(before);
}

/**
 * Where new entry (row, col) comes from in the matrix before the step, as `MatrixStep` decides:
 * swapped rows trade places, a transpose mirrors, anything else stays put. Null = nowhere (it
 * fades in).
 */
export function stepSource(
  spec: MatrixStepSpec,
  row: number,
  col: number,
  beforeRows: number,
  beforeCols: number,
): MatrixCell | null {
  let src: MatrixCell = { row, col };
  if (spec.op === 'transpose') src = { row: col, col: row };
  else if (spec.op === 'swap_rows' && rowsValid(spec, beforeRows, true)) {
    if (row === spec.row) src = { row: spec.otherRow, col };
    else if (row === spec.otherRow) src = { row: spec.row, col };
  }
  return src.row < beforeRows && src.col < beforeCols ? src : null;
}

/** Python arguments after the entries: `swap=(i, j)` or `transpose=True`. */
export function stepPythonKwargs(spec: MatrixStepSpec, beforeRows: number): string {
  if (spec.op === 'transpose') return ', transpose=True';
  if (spec.op === 'swap_rows' && rowsValid(spec, beforeRows, true)) return `, swap=(${spec.row}, ${spec.otherRow})`;
  return '';
}

function factorTex(factor: string): { sign: '+' | '-'; body: string } {
  const r = parseRational(factor);
  if (r) {
    const abs = { ...r, n: Math.abs(r.n) };
    return { sign: r.n < 0 ? '-' : '+', body: abs.n === abs.d ? '' : formatRational(abs) };
  }
  const f = factor.trim();
  if (f.startsWith('-') && !isSum(f.slice(1))) return { sign: '-', body: bracketed(f.slice(1)) + ' ' };
  return { sign: '+', body: bracketed(f) + ' ' };
}

/** Row-operation label, e.g. `R_{2} \to R_{2} - 2R_{1}`; null for edits and transposes. */
export function stepLabelTex(spec: MatrixStepSpec): string | null {
  const R = (i: number) => `R_{${i + 1}}`;
  switch (spec.op) {
    case 'swap_rows':
      return `${R(spec.row)} \\leftrightarrow ${R(spec.otherRow)}`;
    case 'scale_row': {
      const { sign, body } = factorTex(spec.factor);
      return `${R(spec.row)} \\to ${sign === '-' ? '-' : ''}${body}${R(spec.row)}`;
    }
    case 'add_row': {
      const { sign, body } = factorTex(spec.factor);
      return `${R(spec.row)} \\to ${R(spec.row)} ${sign} ${body}${R(spec.otherRow)}`;
    }
    default:
      return null;
  }
}

/** Plain-text name of a step for clip labels: `R1 ↔ R2`, `R2 → R2 − 2·R1`, `Transpose`. */
export function matrixStepTitle(spec: MatrixStepSpec): string {
  const R = (i: number) => `R${i + 1}`;
  const r = parseRational(spec.factor);
  const plain = r ? (r.d === 1 || r.decimal ? String(Math.abs(r.n / r.d)) : `${Math.abs(r.n)}/${r.d}`) : spec.factor.trim().replace(/^-/, '');
  const negative = r ? r.n < 0 : spec.factor.trim().startsWith('-');
  const times = (row: number) => (r && Math.abs(r.n) === r.d ? R(row) : `${plain}·${R(row)}`);
  switch (spec.op) {
    case 'swap_rows':
      return `${R(spec.row)} ↔ ${R(spec.otherRow)}`;
    case 'scale_row':
      return `${R(spec.row)} → ${negative ? '−' : ''}${times(spec.row)}`;
    case 'add_row':
      return `${R(spec.row)} → ${R(spec.row)} ${negative ? '−' : '+'} ${times(spec.otherRow)}`;
    case 'edit':
      return 'Edit entries';
    case 'transpose':
      return 'Transpose';
  }
}

// ── States over time ──

/** The matrix as it looks after a number of steps. */
export interface MatrixState {
  /** 0 = the matrix as created; k = after the k-th step. */
  index: number;
  clip: MatrixStepClip | null;
  spec: MatrixStepSpec | null;
  /** This state drawn as a matrix: its entries and bar in the matrix's style, its own measure. */
  view: MatrixItem;
  /** When the step into this state starts and ends (−∞ for the first state). */
  start: number;
  end: number;
}

function validAugment(aug: number | null | undefined, cols: number): number | null {
  return aug != null && aug > 0 && aug < cols ? aug : null;
}

/** Every state of the matrix, first the matrix itself, then one after each of its steps. */
export function matrixStates(matrix: MatrixItem, items: Map<ItemId, SceneItem>): MatrixState[] {
  const states: MatrixState[] = [
    { index: 0, clip: null, spec: null, view: matrix, start: -Infinity, end: -Infinity },
  ];
  let entries = matrix.entries;
  let aug = validAugment(matrix.augmentCol, matrixCols(matrix));
  for (const clip of matrixStepClips(matrix.id, items)) {
    const spec = matrixStepOf(clip)!.spec;
    entries = stepResultEntries(entries, spec);
    // Same rule as `HebrewMatrix.with_entries`: a transpose drops the bar, a bar that no longer
    // fits is dropped for good.
    aug = spec.op === 'transpose' ? null : validAugment(aug, entries[0]?.length ?? 0);
    const view: MatrixItem = {
      ...matrix,
      entries,
      augmentCol: aug,
      cellColors: undefined,
      measure: spec.measure,
      measureError: spec.measureError ?? null,
      previewDataUrl: spec.previewDataUrl,
      measureKey: spec.measureKey ?? null,
    };
    states.push({ index: states.length, clip, spec, view, start: clip.startTime, end: clip.startTime + Math.max(0.05, clip.duration) });
  }
  return states;
}

/** Index of the state shown at `time` (a step's state from the moment the step starts). */
export function matrixStateIndexAt(states: readonly MatrixState[], time: number): number {
  let k = 0;
  for (let i = 1; i < states.length; i++) if (states[i]!.start <= time) k = i;
  return k;
}

/** The matrix as it is at `time`: its entries, bar and measured geometry in that state. */
export function matrixViewAt(matrix: MatrixItem, items: Map<ItemId, SceneItem>, time: number): MatrixItem {
  const states = matrixStates(matrix, items);
  return states[matrixStateIndexAt(states, time)]!.view;
}

/** The state a step starts from (null when the clip is not a step of this matrix). */
export function matrixStateBefore(
  matrix: MatrixItem,
  items: Map<ItemId, SceneItem>,
  clipId: ItemId,
): MatrixState | null {
  const states = matrixStates(matrix, items);
  const k = states.findIndex((s) => s.clip?.id === clipId);
  return k > 0 ? states[k - 1]! : null;
}

/** 0–1 through the step into `state` at `time`, or null when it is not playing. */
export function stepProgress(state: MatrixState, time: number): number | null {
  if (!state.clip || time < state.start || time >= state.end) return null;
  return (time - state.start) / (state.end - state.start);
}

// ── Colours through the steps ──

export interface MatrixColors {
  /** Brackets and bar. */
  frame: string;
  /** By `cellKey`. */
  cells: Map<string, string>;
}

const COLOR_CLIP_DEFAULT = '#38bdf8';

function clipColor(raw: string | undefined): string {
  const c = raw?.trim() ?? '';
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : COLOR_CLIP_DEFAULT;
}

/** Colour clips (`target_animation` colour) on this matrix, in play order. */
export function matrixColorClips(matrixId: ItemId, items: Map<ItemId, SceneItem>): TargetAnimationItem[] {
  return [...items.values()]
    .filter((it): it is TargetAnimationItem => it.kind === 'target_animation' && it.mode === 'color')
    .filter((c) => c.targets.some((r) => r.targetId === matrixId))
    .sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
}

/** Colour clips that play while the matrix is in state `k` (from its step until the next one). */
export function colorClipsInState(
  states: readonly MatrixState[],
  k: number,
  clips: readonly TargetAnimationItem[],
): TargetAnimationItem[] {
  const from = states[k]!.start;
  const until = states[k + 1]?.start ?? Infinity;
  return clips.filter((c) => c.startTime >= from && c.startTime < until);
}

/** A colour clip's colour and the entries it recolours in a state (empty = the whole matrix). */
export function colorClipOn(clip: TargetAnimationItem, matrixId: ItemId, view: MatrixItem): { color: string; cells: MatrixCell[] } {
  const row = clip.targets.find((r) => r.targetId === matrixId)!;
  return { color: clipColor(row.color), cells: normalizeCells(row.cells, matrixRows(view), matrixCols(view)) };
}

function applyColor(colors: MatrixColors, color: string, cells: readonly MatrixCell[]): void {
  if (cells.length === 0) colors.frame = color;
  const keys = cells.length ? cells.map(cellKey) : [...colors.cells.keys()];
  for (const k of keys) colors.cells.set(k, color);
}

function cloneColors(c: MatrixColors): MatrixColors {
  return { frame: c.frame, cells: new Map(c.cells) };
}

/**
 * Colours of each state: as it starts (carried from the state before, entry by entry, like
 * `MatrixStep` does) and as it ends (after its colour clips have played).
 */
export function matrixStateColors(
  matrix: MatrixItem,
  items: Map<ItemId, SceneItem>,
  states: readonly MatrixState[] = matrixStates(matrix, items),
): { start: MatrixColors; end: MatrixColors }[] {
  const clips = matrixColorClips(matrix.id, items);
  const out: { start: MatrixColors; end: MatrixColors }[] = [];
  states.forEach((state, k) => {
    const view = state.view;
    const rows = matrixRows(view);
    const cols = matrixCols(view);
    let start: MatrixColors;
    if (k === 0) {
      start = { frame: matrix.color, cells: new Map() };
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) start.cells.set(`${i},${j}`, cellColorAt(matrix, i, j));
    } else {
      const prev = states[k - 1]!.view;
      const prevEnd = out[k - 1]!.end;
      start = { frame: prevEnd.frame, cells: new Map() };
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          const src = stepSource(state.spec!, i, j, matrixRows(prev), matrixCols(prev));
          const carried = src && view.entries[i]![j]!.trim() && prev.entries[src.row]![src.col]!.trim();
          start.cells.set(`${i},${j}`, carried ? prevEnd.cells.get(cellKey(src)) ?? matrix.color : matrix.color);
        }
      }
    }
    const end = cloneColors(start);
    for (const clip of colorClipsInState(states, k, clips)) {
      const { color, cells } = colorClipOn(clip, matrix.id, view);
      applyColor(end, color, cells);
    }
    out.push({ start, end });
  });
  return out;
}
