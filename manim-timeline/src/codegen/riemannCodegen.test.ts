import { describe, expect, it } from 'vitest';
import { createAxes, createGraphArea, createShape, defaultSceneDefaults } from '@/store/factories';
import type { GraphAreaItem, GraphPlotItem, SceneItem, ShapeItem } from '@/types/scene';
import { exportManimCode } from './manimExporter';
import { RIEMANN_RECTS_FN } from './graphCodegen';

function scene(counts: number[], extra: SceneItem[] = []): SceneItem[] {
  const axes = { ...createAxes(defaultSceneDefaults()), id: 'ax', startTime: 0, duration: 1, xRange: [0, 3, 1], yRange: [0, 9, 1] } as SceneItem;
  const plot = {
    id: 'p', kind: 'graphPlot', label: 'f', layer: 0, startTime: 1, duration: 1, x: 0, y: 0, scale: 1,
    posSteps: [{ kind: 'absolute' }], audioTrackId: null, axesId: 'ax',
    fn: { id: 'pf', jsExpr: 'x*x', pyExpr: 'x**2', color: '#3b82f6', label: '' }, xDomain: [0, 3], strokeWidth: 2,
  } as GraphPlotItem;
  const a: GraphAreaItem = {
    ...createGraphArea('ax', 2),
    id: 'a',
    duration: 4,
    strokeWidth: 1,
    mode: { areaKind: 'riemann', xMin: 0, xMax: 3, curve: { sourceKind: 'plot', plotId: 'p' }, rule: 'middle', counts },
  };
  return [axes, plot, a, ...extra];
}

const code = (items: SceneItem[]) =>
  exportManimCode(items, { fullFile: true, defaults: defaultSceneDefaults(), audioItems: [], frames: [{ id: 'home', col: 0, row: 0 }], startFrameId: 'home' });

describe('Riemann sums in export', () => {
  it('builds the area as the first count and one target group per later count, from the plot expression', () => {
    const py = code(scene([4, 8, 16]));
    expect(py).not.toContain('EXPORT ERROR');
    expect(py).toContain(`def ${RIEMANN_RECTS_FN}(axes, f, x0, x1, n, share, color, opacity, stroke_width, stroke_color):`);
    expect(py).toMatch(/(axes_\w+_area_\w+) = _riemann_rects\(axes_\w+, lambda x: \(x\*\*2\), 0, 3, 4, 0\.5, ManimColor\("#3b82f6"\), 0\.3500, 1\.0000, ManimColor\("#1e40af"\)\)/);
    expect(py).toMatch(/_area_\w+_n1 = _riemann_rects\([^)]*\), 0, 3, 8, 0\.5/);
    expect(py).toMatch(/_area_\w+_n2 = _riemann_rects\([^)]*\), 0, 3, 16, 0\.5/);
    expect(py).not.toMatch(/_n\d\.set_z_index/);
    // The helper comes before the scene class.
    expect(py.indexOf(`def ${RIEMANN_RECTS_FN}`)).toBeLessThan(py.search(/class \w+\((MovingCamera)?Scene\)/));
  });

  it('fades in the first count and morphs the same mobject into each next one over the clip', () => {
    const py = code(scene([4, 8, 16]));
    // Only the area itself is in the scene: later counts are Transform targets (a Succession adds
    // every mobject it names, so they must not be animation sources).
    expect(py).toMatch(/self\.play\(Succession\(FadeIn\((\w+)\), Transform\(\1, \1_n1\), Transform\(\1, \1_n2\)\), run_time=4\)/);
    expect(py).not.toContain('ReplacementTransform');
  });

  it('shows only the last count when the area is on screen from the start', () => {
    const items = scene([4, 8, 16]);
    (items[2] as GraphAreaItem).visibleAtSceneStart = true;
    const py = code(items);
    expect(py).toMatch(/axes_\w+_area_\w+ = _riemann_rects\([^)]*\), 0, 3, 16, 0\.5/);
    expect(py).not.toMatch(/_area_\w+_n1 = /);
  });

  it('uses one FadeIn for a single count and puts the run time inside a concurrent cluster', () => {
    expect(code(scene([10]))).toMatch(/self\.play\(FadeIn\(axes_\w+_area_\w+\), run_time=4\)/);
    const shape = { ...createShape(2.5), id: 's', duration: 1 } as ShapeItem;
    expect(code(scene([2, 4], [shape]))).toMatch(/Succession\(Wait\(0\.0000\), Succession\(FadeIn\((\w+)\), Transform\(\1, \1_n1\), run_time=4\.000000\)\)/);
  });

  it('refuses counts out of range', () => {
    expect(code(scene([0, 4]))).toMatch(/EXPORT ERROR: Graph area .*Riemann counts must be whole numbers from 1 to 200/);
  });
});
