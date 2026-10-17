import type {
  MatrixBracket,
  MatrixCell,
  MatrixCellBox,
  MatrixCellColor,
  MatrixItem,
  MatrixMeasure,
  SegmentLocalBox,
} from '@/types/scene';
import { texPreviewText } from './texPreviewText';

/**
 * Matrix helpers shared by the editor, canvas preview and export: size and resizing, entry
 * colours, cell picks (row, column, block, diagonal, minor), pasting LaTeX, and the geometry of
 * the typeset matrix (measured by the server, or estimated until then).
 */

export const MATRIX_MAX_SIZE = 12;

export const MATRIX_BRACKETS: readonly { id: MatrixBracket; label: string; open: string; close: string }[] = [
  { id: 'square', label: 'Square', open: '[', close: ']' },
  { id: 'round', label: 'Round', open: '(', close: ')' },
  { id: 'curly', label: 'Curly', open: '{', close: '}' },
  { id: 'bars', label: 'Determinant', open: '|', close: '|' },
  { id: 'double_bars', label: 'Norm', open: '‖', close: '‖' },
  { id: 'none', label: 'None', open: '', close: '' },
];

export function matrixRows(item: Pick<MatrixItem, 'entries'>): number {
  return item.entries.length;
}

export function matrixCols(item: Pick<MatrixItem, 'entries'>): number {
  return item.entries[0]?.length ?? 0;
}

function clampSize(n: number): number {
  return Math.max(1, Math.min(MATRIX_MAX_SIZE, Math.round(n)));
}

/** Entries resized to `rows × cols`, keeping what fits and filling new entries with `''`. */
export function resizeMatrixEntries(entries: readonly (readonly string[])[], rows: number, cols: number): string[][] {
  const r = clampSize(rows);
  const c = clampSize(cols);
  return Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => entries[i]?.[j] ?? ''));
}

/** Patch that resizes a matrix: entries, entry colours that still fit, and the augment bar. */
export function resizeMatrixPatch(item: MatrixItem, rows: number, cols: number): Partial<MatrixItem> {
  const entries = resizeMatrixEntries(item.entries, rows, cols);
  const r = entries.length;
  const c = entries[0]!.length;
  const patch: Partial<MatrixItem> = { entries };
  if (item.cellColors?.length) patch.cellColors = item.cellColors.filter((cc) => cc.row < r && cc.col < c);
  if (item.augmentCol != null && item.augmentCol >= c) patch.augmentCol = null;
  return patch;
}

export function cellKey(cell: MatrixCell): string {
  return `${cell.row},${cell.col}`;
}

/** In-range, de-duplicated cells in row-major order. */
export function normalizeCells(cells: readonly MatrixCell[] | null | undefined, rows: number, cols: number): MatrixCell[] {
  const seen = new Set<string>();
  const out: MatrixCell[] = [];
  for (const c of cells ?? []) {
    if (!Number.isInteger(c.row) || !Number.isInteger(c.col)) continue;
    if (c.row < 0 || c.row >= rows || c.col < 0 || c.col >= cols) continue;
    const k = cellKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ row: c.row, col: c.col });
  }
  return out.sort((a, b) => a.row - b.row || a.col - b.col);
}

/** The item's cells that are actually in range for `item` (empty = none / whole matrix). */
export function matrixCellsFor(item: MatrixItem, cells: readonly MatrixCell[] | null | undefined): MatrixCell[] {
  return normalizeCells(cells, matrixRows(item), matrixCols(item));
}

/** Colour entry (row, col) is drawn in. */
export function cellColorAt(item: Pick<MatrixItem, 'color' | 'cellColors'>, row: number, col: number): string {
  return item.cellColors?.find((c) => c.row === row && c.col === col)?.color ?? item.color;
}

/** Entry colours after giving `cells` their own `color` (`null` = back to the matrix colour). */
export function withCellColors(
  item: Pick<MatrixItem, 'cellColors'>,
  cells: readonly MatrixCell[],
  color: string | null,
): MatrixCellColor[] {
  const keys = new Set(cells.map(cellKey));
  const kept = (item.cellColors ?? []).filter((c) => !keys.has(cellKey(c)));
  if (color == null) return kept;
  return [...kept, ...cells.map((c) => ({ row: c.row, col: c.col, color }))].sort((a, b) => a.row - b.row || a.col - b.col);
}

/** Per-entry colours (null = the matrix colour), or null when no entry has its own colour. */
export function matrixEntryColors(item: MatrixItem): (string | null)[][] | null {
  const rows = matrixRows(item);
  const cols = matrixCols(item);
  const own = (item.cellColors ?? []).filter((c) => c.row < rows && c.col < cols);
  if (own.length === 0) return null;
  const grid: (string | null)[][] = Array.from({ length: rows }, () => Array<string | null>(cols).fill(null));
  for (const c of own) grid[c.row]![c.col] = c.color;
  return grid;
}

/** The fields the measured geometry and preview depend on. */
export function matrixMeasureKey(item: MatrixItem): string {
  return JSON.stringify([
    item.entries,
    item.bracket,
    item.align,
    item.augmentCol ?? null,
    item.rowSpacing,
    item.colSpacing,
    item.fontSize,
    item.color,
    matrixEntryColors(item),
  ]);
}

// ── Cell picks ──

export function allCells(rows: number, cols: number): MatrixCell[] {
  const out: MatrixCell[] = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) out.push({ row, col });
  return out;
}

export function rowCells(cols: number, row: number): MatrixCell[] {
  return Array.from({ length: cols }, (_, col) => ({ row, col }));
}

export function columnCells(rows: number, col: number): MatrixCell[] {
  return Array.from({ length: rows }, (_, row) => ({ row, col }));
}

/** Every entry in the rectangle spanned by two corners (any order). */
export function blockCells(a: MatrixCell, b: MatrixCell): MatrixCell[] {
  const out: MatrixCell[] = [];
  for (let row = Math.min(a.row, b.row); row <= Math.max(a.row, b.row); row++) {
    for (let col = Math.min(a.col, b.col); col <= Math.max(a.col, b.col); col++) out.push({ row, col });
  }
  return out;
}

/** Main diagonal (as far as the shorter side goes). */
export function diagonalCells(rows: number, cols: number): MatrixCell[] {
  return Array.from({ length: Math.min(rows, cols) }, (_, i) => ({ row: i, col: i }));
}

/** The minor M_ij: every entry outside row `row` and column `col`. */
export function minorCells(rows: number, cols: number, row: number, col: number): MatrixCell[] {
  return allCells(rows, cols).filter((c) => c.row !== row && c.col !== col);
}

/** Row `row` and column `col` together (what is crossed out to form the minor M_ij). */
export function crossCells(rows: number, cols: number, row: number, col: number): MatrixCell[] {
  return allCells(rows, cols).filter((c) => c.row === row || c.col === col);
}

/** Short description of a cell set, e.g. "row 2", "column 1", "rows 1–2, columns 2–3", "4 entries". */
export function describeCells(cells: readonly MatrixCell[], rows: number, cols: number): string {
  const n = cells.length;
  if (n === 0 || n === rows * cols) return 'whole matrix';
  const rs = [...new Set(cells.map((c) => c.row))].sort((a, b) => a - b);
  const cs = [...new Set(cells.map((c) => c.col))].sort((a, b) => a - b);
  const span = (xs: number[]) => (xs.length === 1 ? `${xs[0]! + 1}` : `${xs[0]! + 1}–${xs[xs.length - 1]! + 1}`);
  const contiguous = (xs: number[]) => xs[xs.length - 1]! - xs[0]! === xs.length - 1;
  if (n === 1) return `entry (${cells[0]!.row + 1}, ${cells[0]!.col + 1})`;
  if (rs.length * cs.length === n && contiguous(rs) && contiguous(cs)) {
    if (cs.length === cols && rs.length === 1) return `row ${rs[0]! + 1}`;
    if (rs.length === rows && cs.length === 1) return `column ${cs[0]! + 1}`;
    if (cs.length === cols) return `rows ${span(rs)}`;
    if (rs.length === rows) return `columns ${span(cs)}`;
    return `rows ${span(rs)}, columns ${span(cs)}`;
  }
  const same = (other: MatrixCell[]) => other.length === n && other.every((c) => cells.some((d) => d.row === c.row && d.col === c.col));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (n === rows + cols - 1 && same(crossCells(rows, cols, i, j))) return `row ${i + 1} + column ${j + 1}`;
      if (n === (rows - 1) * (cols - 1) && same(minorCells(rows, cols, i, j))) return `minor M${i + 1}${j + 1}`;
    }
  }
  return `${n} entries`;
}

// ── Pasting LaTeX ──

const ENV_BRACKETS: Record<string, MatrixBracket> = {
  matrix: 'none',
  pmatrix: 'round',
  bmatrix: 'square',
  Bmatrix: 'curly',
  vmatrix: 'bars',
  Vmatrix: 'double_bars',
};

const DELIM_BRACKETS: Record<string, MatrixBracket> = {
  '[': 'square',
  '(': 'round',
  '\\{': 'curly',
  '\\lbrace': 'curly',
  '|': 'bars',
  '\\vert': 'bars',
  '\\lvert': 'bars',
  '\\|': 'double_bars',
  '\\Vert': 'double_bars',
  '\\lVert': 'double_bars',
  '.': 'none',
};

/** Split at a top-level separator (outside braces and nested environments). */
function splitTopLevel(src: string, sep: '&' | '\\\\'): string[] {
  const parts: string[] = [];
  let depth = 0;
  let envDepth = 0;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === '\\') {
      if (src.startsWith('\\begin{', i)) envDepth++;
      else if (src.startsWith('\\end{', i)) envDepth--;
      else if (sep === '\\\\' && src[i + 1] === '\\' && depth === 0 && envDepth === 0) {
        parts.push(src.slice(start, i));
        start = i + 2;
        i++;
        continue;
      }
      i++; // skip the escaped character (\{, \&, \\ inside groups)
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (sep === '&' && ch === '&' && depth === 0 && envDepth === 0) {
      parts.push(src.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(src.slice(start));
  return parts;
}

/**
 * Read a LaTeX matrix (`pmatrix`, `bmatrix`, …, or `\left[\begin{array}{cc|c}…\end{array}\right]`),
 * with or without `$`. Null when the text is not a matrix or is too big.
 */
export function parseMatrixLatex(
  source: string,
): { entries: string[][]; bracket: MatrixBracket; augmentCol: number | null } | null {
  let s = source.trim().replace(/^\$\$?|\$\$?$/g, '').replace(/^\\\[|\\\]$/g, '').trim();
  let bracket: MatrixBracket = 'none';
  let augmentCol: number | null = null;
  let body: string | null = null;

  const env = /^\\begin\{(matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix)\}([\s\S]*)\\end\{\1\}$/.exec(s);
  if (env) {
    bracket = ENV_BRACKETS[env[1]!]!;
    body = env[2]!;
  } else {
    const lr = /^\\left\s*(\\\{|\\lbrace|\\\||\\Vert|\\lVert|\\vert|\\lvert|[[(|.])([\s\S]*)\\right\s*(\\\}|\\rbrace|\\\||\\Vert|\\rVert|\\vert|\\rvert|[\])|.])$/.exec(s);
    if (lr) {
      bracket = DELIM_BRACKETS[lr[1]!] ?? 'none';
      s = lr[2]!.trim();
    }
    const arr = /^\\begin\{array\}\{([^}]*)\}([\s\S]*)\\end\{array\}$/.exec(s);
    if (!arr) return null;
    const spec = arr[1]!.replace(/@\{[^}]*\}/g, '').replace(/\s/g, '');
    const bar = spec.indexOf('|');
    if (bar > 0) augmentCol = spec.slice(0, bar).replace(/\|/g, '').length;
    body = arr[2]!;
  }

  const rows = splitTopLevel(body.trim(), '\\\\')
    .map((r) => r.replace(/^\s*\[[^\]]*\]/, '')) // drop `\\[4pt]` spacing
    .filter((r, i, all) => r.trim() !== '' || i < all.length - 1);
  if (rows.length === 0) return null;
  const cells = rows.map((r) => splitTopLevel(r, '&').map((c) => c.trim()));
  const cols = Math.max(...cells.map((r) => r.length));
  if (rows.length > MATRIX_MAX_SIZE || cols > MATRIX_MAX_SIZE) return null;
  const entries = cells.map((r) => Array.from({ length: cols }, (_, j) => r[j] ?? ''));
  if (augmentCol != null && (augmentCol <= 0 || augmentCol >= cols)) augmentCol = null;
  return { entries, bracket, augmentCol };
}

// ── Geometry ──

/** Fresh measured geometry, or null when the matrix changed since it was measured. */
export function measuredMatrixGeometry(item: MatrixItem): MatrixMeasure | null {
  if (!item.measure) return null;
  if (item.measureKey != null && item.measureKey !== matrixMeasureKey(item)) return null;
  return item.measure;
}

/**
 * Rough layout from the entry text, used until the measure server has typeset the matrix (and
 * when it is off). Sized like LaTeX at `fontSize`: rows 1.74 em apart, columns 1.6 em apart.
 */
export function estimatedMatrixGeometry(item: MatrixItem): MatrixMeasure {
  const rows = matrixRows(item);
  const cols = matrixCols(item);
  const em = 0.346 * (item.fontSize / 48);
  const textW = (tex: string) => (tex.trim() ? Math.max(0.5, texPreviewText(tex).length * 0.55) * em : 0);
  const colW = Array.from({ length: cols }, (_, j) => Math.max(0.5 * em, ...item.entries.map((r) => textW(r[j] ?? ''))));
  const gap = 1.1 * em * item.colSpacing;
  const barGap = item.augmentCol != null && item.augmentCol > 0 && item.augmentCol < cols ? gap : 0;
  const pitch = 1.74 * em * item.rowSpacing;
  const h = 0.95 * em;
  const bodyW = colW.reduce((a, b) => a + b, 0) + gap * (cols - 1) + barGap;
  const bodyH = pitch * (rows - 1) + h;
  const hasBrackets = item.bracket !== 'none';
  const bw = hasBrackets ? 0.38 * em : 0;
  const bgap = hasBrackets ? 0.06 * em : 0;
  const width = bodyW + 2 * (bw + bgap);
  const height = bodyH + (hasBrackets ? 0.3 * em : 0);
  const cells: MatrixCellBox[] = [];
  let x = -bodyW / 2;
  for (let j = 0; j < cols; j++) {
    if (barGap && j === item.augmentCol) x += barGap;
    for (let i = 0; i < rows; i++) {
      const tex = item.entries[i]![j] ?? '';
      const w = textW(tex);
      if (!w) continue;
      const cx = item.align === 'left' ? x + w / 2 : item.align === 'right' ? x + colW[j]! - w / 2 : x + colW[j]! / 2;
      cells.push({ row: i, col: j, cx, cy: bodyH / 2 - h / 2 - i * pitch, w, h });
    }
    x += colW[j]! + gap;
  }
  const bracketBox = (side: -1 | 1): SegmentLocalBox | null =>
    hasBrackets ? { cx: side * (width / 2 - bw / 2), cy: 0, w: bw, h: height } : null;
  let bar: SegmentLocalBox | null = null;
  if (barGap) {
    const left = -bodyW / 2 + colW.slice(0, item.augmentCol!).reduce((a, b) => a + b, 0) + gap * item.augmentCol!;
    bar = { cx: left - gap / 2 + barGap / 2, cy: 0, w: 0.02, h: height };
  }
  return {
    width,
    height,
    widthInk: width,
    heightInk: height,
    offsetInkX: 0,
    offsetInkY: 0,
    inkLeftX: -width / 2,
    inkRightX: width / 2,
    inkTopY: height / 2,
    inkBottomY: -height / 2,
    cells,
    leftBracket: bracketBox(-1),
    rightBracket: bracketBox(1),
    bar,
  };
}

/** Geometry to draw and hit-test with: measured when fresh, otherwise estimated. */
export function matrixGeometry(item: MatrixItem): MatrixMeasure {
  return measuredMatrixGeometry(item) ?? estimatedMatrixGeometry(item);
}

export interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function boxBounds(b: { cx: number; cy: number; w: number; h: number }): Bounds {
  return { left: b.cx - b.w / 2, right: b.cx + b.w / 2, top: b.cy + b.h / 2, bottom: b.cy - b.h / 2 };
}

function union(boxes: readonly { cx: number; cy: number; w: number; h: number }[]): Bounds | null {
  if (boxes.length === 0) return null;
  const bs = boxes.map(boxBounds);
  return {
    left: Math.min(...bs.map((b) => b.left)),
    right: Math.max(...bs.map((b) => b.right)),
    top: Math.max(...bs.map((b) => b.top)),
    bottom: Math.min(...bs.map((b) => b.bottom)),
  };
}

/** Ink bounds of the given entries (matrix centred at the origin); null when they are all empty. */
export function cellsBounds(geom: MatrixMeasure, cells: readonly MatrixCell[]): Bounds | null {
  const keys = new Set(cells.map(cellKey));
  return union(geom.cells.filter((c) => keys.has(cellKey(c))));
}

/** Ink bounds of the whole matrix (entries, brackets and bar). */
export function matrixInkBounds(geom: MatrixMeasure): Bounds {
  return { left: geom.inkLeftX, right: geom.inkRightX, top: geom.inkTopY, bottom: geom.inkBottomY };
}

export interface Segment2 {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Lines that cross out `cells`, as `HebrewMatrix.strike_lines` draws them: one through each
 * complete row and column (spanning all entries plus `buff`), a slash through any other entry.
 */
export function strikeSegments(
  geom: MatrixMeasure,
  rows: number,
  cols: number,
  cells: readonly MatrixCell[],
  buff: number,
): Segment2[] {
  const sel = new Set(cells.map(cellKey));
  const all = union(geom.cells);
  if (!all) return [];
  const fullRows = Array.from({ length: rows }, (_, i) => i).filter((i) =>
    Array.from({ length: cols }, (_, j) => j).every((j) => sel.has(`${i},${j}`)),
  );
  const fullCols = Array.from({ length: cols }, (_, j) => j).filter((j) =>
    Array.from({ length: rows }, (_, i) => i).every((i) => sel.has(`${i},${j}`)),
  );
  const out: Segment2[] = [];
  for (const i of fullRows) {
    const b = union(geom.cells.filter((c) => c.row === i));
    if (!b) continue;
    const y = (b.top + b.bottom) / 2;
    out.push({ x1: all.left - buff, y1: y, x2: all.right + buff, y2: y });
  }
  for (const j of fullCols) {
    const b = union(geom.cells.filter((c) => c.col === j));
    if (!b) continue;
    const x = (b.left + b.right) / 2;
    out.push({ x1: x, y1: all.top + buff, x2: x, y2: all.bottom - buff });
  }
  for (const c of normalizeCells(cells, rows, cols)) {
    if (fullRows.includes(c.row) || fullCols.includes(c.col)) continue;
    const box = geom.cells.find((b) => b.row === c.row && b.col === c.col);
    if (!box) continue;
    const b = boxBounds(box);
    out.push({ x1: b.left - buff, y1: b.bottom - buff, x2: b.right + buff, y2: b.top + buff });
  }
  return out;
}
