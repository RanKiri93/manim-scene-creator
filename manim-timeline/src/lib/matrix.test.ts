import { describe, expect, it } from 'vitest';
import { createMatrixItem, createTargetAnimation, defaultSceneDefaults } from '@/store/factories';
import type { ItemId, MatrixItem, MatrixMeasure, SceneItem } from '@/types/scene';
import {
  blockCells,
  cellsBounds,
  crossCells,
  describeCells,
  diagonalCells,
  estimatedMatrixGeometry,
  matrixEntryColors,
  matrixGeometry,
  matrixMeasureKey,
  minorCells,
  normalizeCells,
  parseMatrixLatex,
  resizeMatrixEntries,
  resizeMatrixPatch,
  strikeSegments,
  withCellColors,
} from './matrix';
import { laggedProgress, matrixColorState, matrixColorsBefore, matrixIntroState } from './matrixPreview';

const matrix = (over: Partial<MatrixItem> = {}): MatrixItem => ({ ...createMatrixItem(defaultSceneDefaults(), 0), id: 'm', ...over });
const nine = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']];

describe('matrix size', () => {
  it('keeps the entries that fit and fills new ones with blanks', () => {
    expect(resizeMatrixEntries([['a', 'b'], ['c', 'd']], 3, 1)).toEqual([['a'], ['c'], ['']]);
    expect(resizeMatrixEntries([['a']], 0, 40)[0]).toHaveLength(12);
  });

  it('drops entry colours and an augment bar that no longer fit', () => {
    const m = matrix({ entries: nine, augmentCol: 2, cellColors: [{ row: 0, col: 0, color: '#f00' }, { row: 2, col: 2, color: '#0f0' }] });
    const p = resizeMatrixPatch(m, 2, 2);
    expect(p.cellColors).toEqual([{ row: 0, col: 0, color: '#f00' }]);
    expect(p.augmentCol).toBeNull();
  });
});

describe('entry colours', () => {
  it('sets and resets colours of chosen entries and builds the export grid', () => {
    const m = matrix();
    const cellColors = withCellColors(m, [{ row: 1, col: 0 }], '#ff0000');
    expect(matrixEntryColors({ ...m, cellColors })).toEqual([[null, null], ['#ff0000', null]]);
    expect(withCellColors({ cellColors }, [{ row: 1, col: 0 }], null)).toEqual([]);
    expect(matrixEntryColors(m)).toBeNull();
  });

  it('changes the measure key when anything typeset changes', () => {
    const m = matrix();
    expect(matrixMeasureKey({ ...m, x: 3, startTime: 5 })).toBe(matrixMeasureKey(m));
    expect(matrixMeasureKey({ ...m, bracket: 'round' })).not.toBe(matrixMeasureKey(m));
    expect(matrixMeasureKey({ ...m, cellColors: [{ row: 0, col: 0, color: '#123456' }] })).not.toBe(matrixMeasureKey(m));
  });
});

describe('cell picks', () => {
  it('normalizes, picks blocks, the diagonal, minors and crosses', () => {
    expect(normalizeCells([{ row: 1, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }, { row: 5, col: 0 }], 2, 2)).toEqual([{ row: 0, col: 1 }, { row: 1, col: 0 }]);
    expect(blockCells({ row: 1, col: 2 }, { row: 0, col: 1 })).toHaveLength(4);
    expect(diagonalCells(2, 3)).toEqual([{ row: 0, col: 0 }, { row: 1, col: 1 }]);
    expect(minorCells(3, 3, 0, 0)).toEqual(blockCells({ row: 1, col: 1 }, { row: 2, col: 2 }));
    expect(crossCells(3, 3, 1, 1)).toHaveLength(5);
  });

  it('describes a selection in words', () => {
    expect(describeCells([], 3, 3)).toBe('whole matrix');
    expect(describeCells([{ row: 1, col: 2 }], 3, 3)).toBe('entry (2, 3)');
    expect(describeCells(blockCells({ row: 1, col: 0 }, { row: 1, col: 2 }), 3, 3)).toBe('row 2');
    expect(describeCells(blockCells({ row: 0, col: 1 }, { row: 2, col: 1 }), 3, 3)).toBe('column 2');
    expect(describeCells(blockCells({ row: 0, col: 0 }, { row: 1, col: 1 }), 3, 3)).toBe('rows 1–2, columns 1–2');
    expect(describeCells(crossCells(3, 3, 1, 2), 3, 3)).toBe('row 2 + column 3');
    expect(describeCells(minorCells(3, 3, 0, 1), 3, 3)).toBe('minor M12');
    expect(describeCells(diagonalCells(3, 3), 3, 3)).toBe('3 entries');
  });
});

describe('pasting LaTeX', () => {
  it('reads matrix environments with nested braces', () => {
    expect(parseMatrixLatex('$\\begin{pmatrix} \\frac{1}{2} & x_{1,2} \\\\ \\sqrt{2} & 0 \\end{pmatrix}$')).toEqual({
      entries: [['\\frac{1}{2}', 'x_{1,2}'], ['\\sqrt{2}', '0']],
      bracket: 'round',
      augmentCol: null,
    });
    expect(parseMatrixLatex('\\begin{vmatrix} a & b \\\\ c & d \\\\ \\end{vmatrix}')?.bracket).toBe('bars');
  });

  it('reads an augmented array and pads short rows', () => {
    expect(parseMatrixLatex('\\left[\\begin{array}{cc|c} 1 & 0 & 2 \\\\ 0 & 1 \\end{array}\\right]')).toEqual({
      entries: [['1', '0', '2'], ['0', '1', '']],
      bracket: 'square',
      augmentCol: 2,
    });
  });

  it('refuses text that is not a matrix', () => {
    expect(parseMatrixLatex('x^2 + 1')).toBeNull();
    expect(parseMatrixLatex(`\\begin{bmatrix}${'a & '.repeat(12)}a\\end{bmatrix}`)).toBeNull();
  });
});

/** A 2×2 matrix laid out on a unit grid: entries 0.2 wide, centres at x = ±0.5, y = ±0.5. */
const grid: MatrixMeasure = {
  ...estimatedMatrixGeometry(matrix()),
  cells: [
    { row: 0, col: 0, cx: -0.5, cy: 0.5, w: 0.2, h: 0.2 },
    { row: 0, col: 1, cx: 0.5, cy: 0.5, w: 0.2, h: 0.2 },
    { row: 1, col: 0, cx: -0.5, cy: -0.5, w: 0.2, h: 0.2 },
    { row: 1, col: 1, cx: 0.5, cy: -0.5, w: 0.2, h: 0.2 },
  ],
};

describe('matrix geometry', () => {
  it('bounds chosen entries', () => {
    expect(cellsBounds(grid, [{ row: 0, col: 1 }, { row: 1, col: 1 }])).toEqual({ left: 0.4, right: 0.6, top: 0.6, bottom: -0.6 });
    expect(cellsBounds(grid, [])).toBeNull();
  });

  it('strikes rows and columns across all entries, and slashes single entries', () => {
    const s = strikeSegments(grid, 2, 2, crossCells(2, 2, 0, 0), 0.1);
    expect(s).toHaveLength(2);
    expect(s[0]).toEqual({ x1: -0.7, y1: 0.5, x2: 0.7, y2: 0.5 });
    expect(s[1]).toEqual({ x1: -0.5, y1: 0.7, x2: -0.5, y2: -0.7 });
    const slash = strikeSegments(grid, 2, 2, [{ row: 1, col: 1 }], 0);
    expect(slash).toEqual([{ x1: 0.4, y1: -0.6, x2: 0.6, y2: -0.4 }]);
  });

  it('uses the measure only while it matches the matrix', () => {
    const m = matrix({ measure: grid });
    expect(matrixGeometry({ ...m, measureKey: matrixMeasureKey(m) })).toBe(grid);
    expect(matrixGeometry({ ...m, measureKey: 'old' })).not.toBe(grid);
  });
});

describe('matrix preview timing', () => {
  it('spreads LaggedStart parts like Manim', () => {
    // 3 parts, lag 0.6: span 2.2; the last starts at 1.2 / 2.2.
    expect(laggedProgress(0, 0, 3)).toBe(0);
    expect(laggedProgress(1.2 / 2.2, 2, 3)).toBeCloseTo(0);
    expect(laggedProgress(1, 2, 3)).toBe(1);
    expect(laggedProgress(1 / 2.2, 0, 3)).toBeCloseTo(1);
  });

  it('fades the brackets in, then writes row after row', () => {
    const m = matrix({ introStyle: 'rows', duration: 2.2 });
    const items = new Map<ItemId, SceneItem>([[m.id, m]]);
    const s = matrixIntroState(m, grid, 1.0, items);
    expect(s.frame.opacity).toBe(1);
    expect(s.cells.get('0,0')!.wipe).toBeCloseTo(0.4);
    expect(s.cells.get('1,0')!.opacity).toBe(0);
    expect(matrixIntroState(m, grid, 5, items).cells.get('1,1')).toEqual({ opacity: 1, wipe: 1 });
  });

  it('layers colour clips on chosen entries and remembers them for a later blink', () => {
    const m = matrix();
    const ta = createTargetAnimation('color', ['m'], 1, 1);
    ta.targets[0] = { ...ta.targets[0]!, color: '#38bdf8', cells: [{ row: 0, col: 0 }] };
    const items = new Map<ItemId, SceneItem>([[m.id, m], [ta.id, ta]]);
    const mid = matrixColorState(m, 1.5, items);
    expect(mid.frame).toEqual([]);
    expect(mid.cells.get('0,0')![0]!.opacity).toBeCloseTo(0.5);
    expect(mid.cells.has('1,1')).toBe(false);
    const before = matrixColorsBefore(m, 3, items);
    expect(before.cell(0, 0)).toBe('#38bdf8');
    expect(before.cell(1, 1)).toBe(m.color);
  });
});
