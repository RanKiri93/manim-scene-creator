import { describe, expect, it } from 'vitest';
import { createMatrixItem, createTargetAnimation, defaultSceneDefaults } from '@/store/factories';
import type { ItemId, MatrixItem, MatrixMeasure, MatrixStepSpec, SceneItem } from '@/types/scene';
import {
  addEntries,
  computeStepEntries,
  matrixStateColors,
  matrixStateIndexAt,
  matrixStates,
  matrixStepTitle,
  matrixViewAt,
  multiplyEntry,
  parseRational,
  stepBasisChanged,
  stepLabelTex,
  stepResultEntries,
  stepSource,
} from './matrixSteps';
import { arcPoint, matrixColorState, matrixColorsBefore, matrixStepPieces } from './matrixPreview';
import { estimatedMatrixGeometry } from './matrix';

const spec = (over: Partial<MatrixStepSpec>): MatrixStepSpec => ({
  op: 'swap_rows',
  row: 0,
  otherRow: 1,
  factor: '2',
  measure: null,
  previewDataUrl: null,
  ...over,
});

const A = [
  ['1', '2', '3'],
  ['2', '-1', '\\frac{1}{2}'],
];

describe('row operation arithmetic', () => {
  it('reads integers, decimals and fractions', () => {
    expect(parseRational('-3')).toMatchObject({ n: -3, d: 1 });
    expect(parseRational('{-\\frac{2}{4}}')).toMatchObject({ n: -1, d: 2 });
    expect(parseRational('\\dfrac{3}{6}')).toMatchObject({ n: 1, d: 2 });
    expect(parseRational('6/4')).toMatchObject({ n: 3, d: 2 });
    expect(parseRational('0.25')).toMatchObject({ n: 1, d: 4, decimal: true });
    expect(parseRational('−2')).toMatchObject({ n: -2, d: 1 });
    expect(parseRational('x')).toBeNull();
    expect(parseRational('2x')).toBeNull();
  });

  it('works out numbers exactly and writes the rest as products and sums', () => {
    expect(multiplyEntry('-2', '\\frac{1}{2}')).toBe('-1');
    expect(multiplyEntry('\\frac{1}{3}', '2')).toBe('\\frac{2}{3}');
    expect(multiplyEntry('0.5', '3')).toBe('1.5');
    expect(multiplyEntry('2', 'x')).toBe('2 x');
    expect(multiplyEntry('2', 'a+b')).toBe('2 \\left(a+b\\right)');
    expect(multiplyEntry('k', '3')).toBe('k \\cdot 3');
    expect(multiplyEntry('-1', 'a')).toBe('-a');
    expect(multiplyEntry('-1', '-a')).toBe('a');
    expect(multiplyEntry('5', '0')).toBe('0');
    expect(multiplyEntry('2', '')).toBe('');
    expect(addEntries('3', '-2')).toBe('1');
    expect(addEntries('\\frac{1}{2}', '\\frac{1}{3}')).toBe('\\frac{5}{6}');
    expect(addEntries('c', '-2 a')).toBe('c - 2 a');
    expect(addEntries('c', '0')).toBe('c');
    expect(addEntries('0', '2 a')).toBe('2 a');
    expect(addEntries('c', 'k a')).toBe('c + k a');
  });

  it('swaps, scales and adds rows, transposes, and keeps a hand-typed result', () => {
    expect(computeStepEntries(A, spec({ op: 'swap_rows', row: 0, otherRow: 1 }))).toEqual([A[1], A[0]]);
    expect(computeStepEntries(A, spec({ op: 'scale_row', row: 1, factor: '2' }))).toEqual([A[0], ['4', '-2', '1']]);
    expect(computeStepEntries(A, spec({ op: 'add_row', row: 1, otherRow: 0, factor: '-2' }))).toEqual([A[0], ['0', '-5', '-\\frac{11}{2}']]);
    expect(computeStepEntries(A, spec({ op: 'transpose' }))).toEqual([['1', '2'], ['2', '-1'], ['3', '\\frac{1}{2}']]);
    // Rows that are not there, or the same row twice, change nothing.
    expect(computeStepEntries(A, spec({ op: 'swap_rows', row: 0, otherRow: 0 }))).toEqual(A);
    expect(computeStepEntries(A, spec({ op: 'add_row', row: 5, otherRow: 0 }))).toEqual(A);
    const typed = spec({ op: 'scale_row', row: 0, entries: [['x', 'y', 'z'], A[1]!], basis: A });
    expect(stepResultEntries(A, typed)).toEqual([['x', 'y', 'z'], A[1]]);
    expect(stepBasisChanged(A, typed)).toBe(false);
    expect(stepBasisChanged([['9', '9', '9'], A[1]!], typed)).toBe(true);
    // A transpose is always worked out.
    expect(stepResultEntries(A, spec({ op: 'transpose', entries: [['q']] }))).toHaveLength(3);
  });

  it('knows where each new entry comes from', () => {
    expect(stepSource(spec({ op: 'swap_rows', row: 0, otherRow: 1 }), 0, 2, 2, 3)).toEqual({ row: 1, col: 2 });
    expect(stepSource(spec({ op: 'transpose' }), 2, 1, 2, 3)).toEqual({ row: 1, col: 2 });
    expect(stepSource(spec({ op: 'scale_row' }), 1, 1, 2, 3)).toEqual({ row: 1, col: 1 });
    expect(stepSource(spec({ op: 'edit' }), 2, 0, 2, 3)).toBeNull();
  });

  it('labels row operations in LaTeX and in plain text', () => {
    expect(stepLabelTex(spec({ op: 'swap_rows', row: 0, otherRow: 2 }))).toBe('R_{1} \\leftrightarrow R_{3}');
    expect(stepLabelTex(spec({ op: 'add_row', row: 1, otherRow: 0, factor: '-2' }))).toBe('R_{2} \\to R_{2} - 2R_{1}');
    expect(stepLabelTex(spec({ op: 'add_row', row: 1, otherRow: 0, factor: '1' }))).toBe('R_{2} \\to R_{2} + R_{1}');
    expect(stepLabelTex(spec({ op: 'scale_row', row: 0, factor: '\\frac{1}{2}' }))).toBe('R_{1} \\to \\frac{1}{2}R_{1}');
    expect(stepLabelTex(spec({ op: 'scale_row', row: 0, factor: '-1' }))).toBe('R_{1} \\to -R_{1}');
    expect(stepLabelTex(spec({ op: 'add_row', row: 0, otherRow: 1, factor: 'k' }))).toBe('R_{1} \\to R_{1} + k R_{2}');
    expect(stepLabelTex(spec({ op: 'transpose' }))).toBeNull();
    expect(matrixStepTitle(spec({ op: 'add_row', row: 1, otherRow: 0, factor: '-2' }))).toBe('R2 → R2 − 2·R1');
    expect(matrixStepTitle(spec({ op: 'scale_row', row: 2, factor: '1/3' }))).toBe('R3 → 1/3·R3');
    expect(matrixStepTitle(spec({ op: 'swap_rows', row: 0, otherRow: 1 }))).toBe('R1 ↔ R2');
  });
});

describe('matrix states over time', () => {
  const matrix = (over: Partial<MatrixItem> = {}): MatrixItem => ({
    ...createMatrixItem(defaultSceneDefaults(), 0),
    id: 'm1',
    entries: A.map((r) => [...r]),
    augmentCol: 2,
    color: '#ffffff',
    ...over,
  });
  const step = (id: string, start: number, s: Partial<MatrixStepSpec>) => {
    const clip = createTargetAnimation('matrix_step', ['m1'], start, 1);
    clip.id = id;
    clip.targets[0]!.step = spec(s);
    return clip;
  };
  const colour = (id: string, start: number, color: string, cells: { row: number; col: number }[]) => {
    const clip = createTargetAnimation('color', ['m1'], start, 0.5);
    clip.id = id;
    clip.targets[0] = { targetId: 'm1', color, cells };
    return clip;
  };
  const scene = (...items: SceneItem[]) => new Map<ItemId, SceneItem>(items.map((it) => [it.id, it]));

  it('chains steps in time order and drops the bar on a transpose', () => {
    const items = scene(matrix(), step('t', 5, { op: 'transpose' }), step('s', 2, { op: 'swap_rows' }));
    const states = matrixStates(items.get('m1') as MatrixItem, items);
    expect(states.map((s) => s.clip?.id ?? null)).toEqual([null, 's', 't']);
    expect(states[1]!.view.entries).toEqual([A[1], A[0]]);
    expect(states[1]!.view.augmentCol).toBe(2);
    expect(states[2]!.view.entries).toEqual([['2', '1'], ['-1', '2'], ['\\frac{1}{2}', '3']]);
    expect(states[2]!.view.augmentCol).toBeNull();
    expect(matrixStateIndexAt(states, 1.9)).toBe(0);
    expect(matrixStateIndexAt(states, 2)).toBe(1);
    expect(matrixViewAt(items.get('m1') as MatrixItem, items, 9).entries).toHaveLength(3);
  });

  it('carries entry colours through a step and puts colour clips in the state they play in', () => {
    const items = scene(
      matrix({ cellColors: [{ row: 0, col: 2, color: '#ff0000' }] }),
      step('s', 2, { op: 'swap_rows' }),
      colour('c1', 1, '#00ff00', [{ row: 1, col: 0 }]),
      colour('c2', 4, '#0000ff', [{ row: 0, col: 0 }]),
    );
    const m = items.get('m1') as MatrixItem;
    const colors = matrixStateColors(m, items);
    // Entry (0, 2) was red and entry (1, 0) green; after the swap they sit in the other row.
    expect(colors[1]!.start.cells.get('1,2')).toBe('#ff0000');
    expect(colors[1]!.start.cells.get('0,0')).toBe('#00ff00');
    expect(colors[1]!.end.cells.get('0,0')).toBe('#0000ff');
    expect(matrixColorsBefore(m, 3, items).cell(1, 2)).toBe('#ff0000');
    // On the canvas the state after the step is typeset in the matrix colour, so the carried
    // colours are laid over it; the state before keeps its own entry colours.
    const shown = matrixColorState(m, 3, items);
    expect(shown.cells.get('1,2')).toEqual([{ color: '#ff0000', opacity: 1 }]);
    expect(shown.previous?.cells.get('1,0')).toEqual([{ color: '#00ff00', opacity: 1 }]);
    expect(shown.previous?.cells.has('0,2')).toBe(false);
  });
});

describe('a step playing on the canvas', () => {
  const view = (entries: string[][]): MatrixItem => ({ ...createMatrixItem(defaultSceneDefaults(), 0), entries });
  const geom = (v: MatrixItem): MatrixMeasure => estimatedMatrixGeometry(v);

  it('moves Manim-style along an arc', () => {
    const a = { x: 0, y: 1 };
    const b = { x: 0, y: -1 };
    expect(arcPoint(a, b, Math.PI / 2, 0)).toEqual(a);
    const end = arcPoint(a, b, Math.PI / 2, 1);
    expect(end.x).toBeCloseTo(0);
    expect(end.y).toBeCloseTo(-1);
    // Moving down with a positive arc bulges to the left (like the other row to the right).
    expect(arcPoint(a, b, Math.PI / 2, 0.5).x).toBeLessThan(-0.1);
    expect(arcPoint(b, a, Math.PI / 2, 0.5).x).toBeGreaterThan(0.1);
  });

  it('moves unchanged entries, cross-fades changed ones and keeps the brackets', () => {
    const before = view([['1', '2'], ['3', '4']]);
    const after = view([['1', '2'], ['0', '-2']]);
    const s = spec({ op: 'add_row', row: 1, otherRow: 0, factor: '-3' });
    const mid = matrixStepPieces(s, before, geom(before), after, geom(after), 0.5);
    const moved = mid.filter((p) => p.opacity === 1 && 'cell' in p.ref);
    expect(moved.map((p) => p.key).sort()).toEqual(['c0,0', 'c0,1']);
    const fading = mid.filter((p) => p.opacity > 0 && p.opacity < 1);
    expect(fading.map((p) => p.key).sort()).toEqual(['c1,0', 'c1,1', 'p1,0', 'p1,1']);
    expect(mid.filter((p) => 'frame' in p.ref).map((p) => p.key).sort()).toEqual(['clb', 'crb']);
    // At the end only the new pieces are left, where the new matrix has them.
    const end = matrixStepPieces(s, before, geom(before), after, geom(after), 1);
    expect(end.every((p) => p.from === 'cur')).toBe(true);
  });

  it('swings swapped rows and cross-fades brackets whose height changes', () => {
    const before = view([['1', '2'], ['3', '4']]);
    const swapped = view([['3', '4'], ['1', '2']]);
    const g0 = geom(before);
    const mid = matrixStepPieces(spec({ op: 'swap_rows' }), before, g0, swapped, geom(swapped), 0.5);
    const p = mid.find((x) => x.key === 'c0,0')!;
    const from = g0.cells.find((c) => c.row === 1 && c.col === 0)!;
    expect(Math.abs(p.box.cx - from.cx)).toBeGreaterThan(0.01);
    const tall = view([['1', '3'], ['2', '4'], ['5', '6']]);
    const t = matrixStepPieces(spec({ op: 'edit' }), before, g0, tall, geom(tall), 0.5);
    expect(t.filter((x) => 'frame' in x.ref).map((x) => x.key).sort()).toEqual(['clb', 'crb', 'plb', 'prb']);
  });
});
