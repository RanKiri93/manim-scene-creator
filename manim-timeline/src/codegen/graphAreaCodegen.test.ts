import { describe, expect, it } from 'vitest';
import { createAxes, createGraphArea, defaultSceneDefaults } from '@/store/factories';
import type { GraphAreaItem, GraphPlotItem, SceneItem, ShapeItem } from '@/types/scene';
import { createShape } from '@/store/factories';
import { exportManimCode } from './manimExporter';
import { GRAPH_AREA_REVEAL_CLASS } from './graphCodegen';

function scene(area: Partial<GraphAreaItem>, extra: SceneItem[] = []): SceneItem[] {
  const axes = { ...createAxes(defaultSceneDefaults()), id: 'ax', startTime: 0, duration: 1, xRange: [-3, 3, 1], yRange: [-1, 4, 1] } as SceneItem;
  const plot: GraphPlotItem = {
    id: 'p', kind: 'graphPlot', label: 'f', layer: 0, startTime: 1, duration: 1, x: 0, y: 0, scale: 1,
    posSteps: [{ kind: 'absolute' }], audioTrackId: null, axesId: 'ax',
    fn: { id: 'pf', jsExpr: 'x*x', pyExpr: 'x**2', color: '#3b82f6', label: '' }, xDomain: [-3, 3], strokeWidth: 2, lineStyle: 'dashed',
  } as GraphPlotItem;
  const a: GraphAreaItem = {
    ...createGraphArea('ax', 2),
    id: 'a',
    duration: 2,
    mode: { areaKind: 'underCurve', xMin: 0.5, xMax: 2, curve: { sourceKind: 'plot', plotId: 'p' }, showBoundaryPlot: false },
    ...area,
  };
  return [axes, plot, a, ...extra];
}

const code = (items: SceneItem[]) =>
  exportManimCode(items, { fullFile: true, defaults: defaultSceneDefaults(), audioItems: [], frames: [{ id: 'home', col: 0, row: 0 }], startFrameId: 'home' });

describe('graph area entrances in export', () => {
  it('keeps FadeIn and no helper class for the default entrance', () => {
    const py = code(scene({}));
    expect(py).toMatch(/self\.play\(FadeIn\(\w+_area_\w+\), run_time=2\)/);
    expect(py).not.toContain(`class ${GRAPH_AREA_REVEAL_CLASS}`);
  });

  it('sweeps with the plot expression as the boundary, over the same run time', () => {
    const py = code(scene({ introStyle: 'sweep_right' }));
    expect(py).toContain(`class ${GRAPH_AREA_REVEAL_CLASS}(Animation):`);
    expect(py).toContain('super().__init__(area, introducer=True, **kwargs)');
    expect(py).toMatch(/self\.play\(_AreaReveal\((\w+_area_\w+), (\w+), lambda x: \(x\*\*2\), lambda x: 0\.0, 0\.5, 2, "sweep_right"\), run_time=2\)/);
    // The helper comes before the scene class (multi-scene export splits at the first class).
    expect(py.indexOf(`class ${GRAPH_AREA_REVEAL_CLASS}`)).toBeLessThan(py.indexOf('(MovingCameraScene)') >= 0 ? py.indexOf('(MovingCameraScene)') : py.indexOf('(Scene)'));
  });

  it('rises between two curves from the lower one', () => {
    const py = code(
      scene({
        introStyle: 'rise',
        mode: { areaKind: 'betweenCurves', xMin: -1, xMax: 1, lower: { sourceKind: 'expr', jsExpr: '0.5', pyExpr: '0.5' }, upper: { sourceKind: 'plot', plotId: 'p' }, showBoundaryPlot: false },
      }),
    );
    expect(py).toMatch(/_AreaReveal\(\w+, \w+, lambda x: \(x\*\*2\), lambda x: \(0\.5\), -1, 1, "rise"\)/);
  });

  it('puts the run time on the reveal inside a concurrent cluster', () => {
    const shape = { ...createShape(1.5), id: 's', duration: 2 } as ShapeItem;
    const py = code(scene({ introStyle: 'sweep_left' }, [shape]));
    // The cluster starts with the plot at 1 s; the area starts at 2 s.
    expect(py).toMatch(/Succession\(Wait\(1\.0000\), _AreaReveal\(.*"sweep_left", run_time=2\.000000\)\)/);
  });

  it('falls back to FadeIn for parallelograms and disks', () => {
    const py = code(scene({ introStyle: 'sweep_right', mode: { areaKind: 'disk', cx: 0, cy: 1, radius: 0.5 } }));
    expect(py).toMatch(/FadeIn\(\w+_area_\w+\)/);
    expect(py).not.toContain(`class ${GRAPH_AREA_REVEAL_CLASS}`);
  });
});
