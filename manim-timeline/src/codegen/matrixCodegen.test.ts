import { describe, expect, it } from 'vitest';
import { exportManimCode } from '@/codegen/manimExporter';
import { generateMatrixDef, generateMatrixPos, matrixIntroAnimExpr, matrixTargetExpr } from '@/codegen/matrixCodegen';
import { createBlinkAnimation, createMatrixItem, createSurroundingRect, createTargetAnimation, defaultSceneDefaults } from '@/store/factories';
import type { MatrixItem, SceneItem, SurroundingRectItem } from '@/types/scene';

const matrix = (over: Partial<MatrixItem> = {}): MatrixItem => ({ ...createMatrixItem(defaultSceneDefaults(), 0), id: 'm1', ...over });

describe('matrix export', () => {
  it('emits a HebrewMatrix with the entries as Python strings', () => {
    const def = generateMatrixDef(matrix({ entries: [['1', '\\frac{1}{2}'], ['-3', '']], color: '#ffffff' }), 'matrix_1', 0);
    expect(def).toBe('matrix_1 = HebrewMatrix([["1", "\\\\frac{1}{2}"], ["-3", ""]], bracket="square", font_size=36, color=ManimColor("#ffffff"))\n');
  });

  it('passes alignment, the augment bar, spacing and entry colours only when set', () => {
    const def = generateMatrixDef(
      matrix({
        entries: [['1', '0', '2'], ['0', '1', '3']],
        bracket: 'round',
        align: 'right',
        augmentCol: 2,
        rowSpacing: 1.5,
        colSpacing: 2,
        cellColors: [{ row: 1, col: 2, color: '#ff0000' }],
      }),
      'm',
      0,
    );
    expect(def).toContain('bracket="round", align="right", augment_col=2, row_spacing=1.5000, col_spacing=2.0000');
    expect(def).toContain('entry_colors=[[None, None, None], [None, None, ManimColor("#ff0000")]]');
    // A bar after the last column is no bar.
    expect(generateMatrixDef(matrix({ augmentCol: 2 }), 'm', 0)).not.toContain('augment_col');
  });

  it('places the matrix like other objects', () => {
    const item = matrix({ x: 1.5, y: -1, scale: 0.8 });
    expect(generateMatrixPos(item, 'm', 0, new Map(), new Map([[item.id, item]]))).toBe('m.scale(0.800000)\nm.move_to([1.500000, -1.000000, 0])\n');
  });

  it('writes, fades, or staggers rows / columns / entries after the brackets', () => {
    expect(matrixIntroAnimExpr(matrix({ introStyle: 'write' }), 'm')).toBe('Write(m)');
    expect(matrixIntroAnimExpr(matrix({ introStyle: 'fade_in' }), 'm')).toBe('FadeIn(m)');
    expect(matrixIntroAnimExpr(matrix({ introStyle: 'rows' }), 'm')).toBe(
      'LaggedStart(FadeIn(VGroup(m.get_brackets(), m.get_bar()), run_time=1), *[Write(g, run_time=1) for g in m.get_rows() if g.submobjects], lag_ratio=0.6)',
    );
    expect(matrixIntroAnimExpr(matrix({ introStyle: 'columns', bracket: 'none' }), 'm')).toBe(
      'LaggedStart(*[Write(g, run_time=1) for g in m.get_columns() if g.submobjects], lag_ratio=0.6)',
    );
    expect(matrixIntroAnimExpr(matrix({ introStyle: 'entries' }), 'm')).toContain('for g in m.get_entries()]');
    expect(matrixIntroAnimExpr(matrix({ introStyle: 'rows', bracket: 'none', entries: [['', '']] }), 'm')).toBe('FadeIn(m)');
  });

  it('addresses selected entries with cells(), or the whole matrix', () => {
    const item = matrix();
    expect(matrixTargetExpr(item, 'm', [{ row: 1, col: 1 }, { row: 0, col: 1 }, { row: 5, col: 0 }])).toBe('m.cells((0, 1), (1, 1))');
    expect(matrixTargetExpr(item, 'm', [])).toBe('m');
  });

  it('imports HebrewMatrix and plays the intro over the clip duration in a full scene', () => {
    const opts = { fullFile: true, defaults: defaultSceneDefaults() };
    const code = exportManimCode([matrix({ duration: 2.5, introStyle: 'rows' })], opts);
    expect(code).toContain('from hebrew_matrix import HebrewMatrix');
    expect(code).toContain('matrix_1 = HebrewMatrix([["a", "b"], ["c", "d"]]');
    expect(code).toMatch(/self\.play\(LaggedStart\(.*\), run_time=2\.500000\)/);
    expect(exportManimCode([], opts)).not.toContain('hebrew_matrix');
  });
});

describe('matrix entries in clips', () => {
  const opts = { fullFile: true, defaults: defaultSceneDefaults() };
  const m = () => matrix({ entries: [['1', '2'], ['3', '4']], color: '#ffffff', visibleAtSceneStart: true });

  it('recolours only the chosen entries in a colour clip', () => {
    const ta = createTargetAnimation('color', ['m1'], 1, 0.5);
    ta.targets[0] = { ...ta.targets[0]!, color: '#38bdf8', cells: [{ row: 1, col: 1 }, { row: 0, col: 0 }] };
    expect(exportManimCode([m(), ta], opts)).toContain('matrix_1.cells((0, 0), (1, 1)).animate.set_color(ManimColor("#38bdf8"))');
  });

  it('blinks chosen entries and restores the colours they had when the blink started', () => {
    const ta = createTargetAnimation('color', ['m1'], 0.5, 0.5);
    ta.targets[0] = { ...ta.targets[0]!, color: '#38bdf8', cells: [{ row: 0, col: 0 }] };
    const bl = createBlinkAnimation(['m1'], 2, 1);
    bl.targets[0] = { ...bl.targets[0]!, mode: 'color', blinkColor: '#fbbf24', cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }] };
    const code = exportManimCode([m(), ta, bl], opts);
    expect(code).toContain('matrix_1.cells((0, 0), (0, 1)).animate.set_color(ManimColor("#fbbf24"))');
    expect(code).toContain('matrix_1.cells((0, 0)).animate.set_color(ManimColor("#38bdf8"))');
    expect(code).toContain('matrix_1.cells((0, 1)).animate.set_color(ManimColor("#ffffff"))');
  });

  it('scales chosen entries in a scale blink', () => {
    const bl = createBlinkAnimation(['m1'], 1, 1);
    bl.targets[0] = { ...bl.targets[0]!, scaleFactor: 1.5, cells: [{ row: 1, col: 1 }] };
    const code = exportManimCode([m(), bl], opts);
    expect(code).toContain('matrix_1.cells((1, 1)).animate.scale(1.500000)');
    expect(code).toContain('matrix_1.cells((1, 1)).animate.scale(0.666667)');
  });

  it('boxes chosen entries, or crosses them out', () => {
    const box = { ...createSurroundingRect(['m1'], 1), cells: [{ row: 0, col: 1 }, { row: 1, col: 1 }] } as SurroundingRectItem;
    expect(exportManimCode([m(), box], opts)).toMatch(/sr_1_tgt = matrix_1\.cells\(\(0, 1\), \(1, 1\)\)\n\s*sr_1 = SurroundingRectangle\(sr_1_tgt/);
    const strike: SceneItem = { ...box, mark: 'strike', cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }] };
    expect(exportManimCode([m(), strike], opts)).toContain(
      'sr_1 = matrix_1.strike_lines([(0, 0), (0, 1), (1, 0)], buff=0.1500, color=ManimColor("#fbbf24"), stroke_width=2.0000)',
    );
  });
});
