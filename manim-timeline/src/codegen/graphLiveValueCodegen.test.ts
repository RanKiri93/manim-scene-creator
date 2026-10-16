import { describe, expect, it } from 'vitest';
import { createAxes, createGraphDotItem, createGraphPlot, defaultSceneDefaults } from '@/store/factories';
import type { GraphDotItem, SceneItem } from '@/types/scene';
import { exportManimCode } from './manimExporter';

function scene(template: string | undefined, attach = true): SceneItem[] {
  const axes = { ...createAxes(defaultSceneDefaults()), id: 'ax', startTime: 0, duration: 1, xRange: [-2, 2, 1], yRange: [-1, 4, 1] } as SceneItem;
  const plot = createGraphPlot('ax', 1);
  plot.id = 'p';
  plot.fn = { ...plot.fn, jsExpr: 'x*x', pyExpr: 'x**2' };
  plot.xDomain = [-2, 2];
  const dot: GraphDotItem = createGraphDotItem('ax', 2);
  dot.id = 'd';
  dot.dot = {
    ...dot.dot,
    showCoordinates: true,
    coordinatePrecision: 1,
    ...(template !== undefined ? { valueTemplate: template } : {}),
    attachment: attach ? { kind: 'function', graphPlotId: 'p', x: 1 } : { kind: 'free' },
  };
  return [axes, plot, dot];
}

const code = (items: SceneItem[]) => exportManimCode(items, { fullFile: true, defaults: defaultSceneDefaults() });

describe('live value labels in export', () => {
  it('keeps the "(x, y)" label without a template', () => {
    const py = code(scene(undefined));
    expect(py).toMatch(/_coord = _graph_coord_text\(axes_\w+, 18, /);
    expect(py).toContain('return ("-" if value < 0 and rounded != 0 else "") + text');
  });

  it('empties glyphs it swaps out, so a moving label leaves no copy behind', () => {
    for (const py of [code(scene(undefined)), code(scene('f(x) = {y}'))]) {
      expect(py).toContain('def _graph_retire_glyphs(coord):\n    for old in coord.family_members_with_points():\n        old.clear_points()\n    coord.remove(*coord.submobjects)');
      expect(py).not.toMatch(/^\s+coord\.remove\(\*coord\.submobjects\)\n\s+coord\.add/m);
      // One definition and a call in each path ("(x, y)" and template).
      expect(py.match(/_graph_retire_glyphs\(coord\)/g)!.length).toBe(3);
    }
  });

  it('builds fixed pieces once and fills values from cached glyphs', () => {
    const py = code(scene('f(x) = {y}'));
    expect(py).not.toContain('EXPORT ERROR');
    expect(py).toMatch(/_coord = _graph_value_text\(18, ManimColor\("#e2e8f0"\), \[HebrewMathLine\("\$f\(x\) =\$", font_size=18, color=ManimColor\("#e2e8f0"\), hebrew_font="Alef"\), "y"\], None\)/);
    expect(py).toContain('def _graph_value_text(font_size, color, parts, slope):');
    expect(py).toContain('if getattr(coord, "_graph_parts", None) is not None:');
    // No TeX inside the updater: the value text uses the digit glyph atlas.
    expect(py).toContain('_graph_coordinate_glyphs(t, coord._graph_font_size, coord._graph_color) if isinstance(t, str) else t.copy()');
  });

  it('computes {slope} from the plot expression with the clamped step', () => {
    const py = code(scene('\\text{slope} = {slope}'));
    expect(py).toContain('[HebrewMathLine("$\\\\text{slope} =$"');
    expect(py).toContain(', "slope"], lambda _x: (lambda _f, _x0, _x1: (_f(_x1) - _f(_x0)) / (_x1 - _x0) if _x1 > _x0 else float("nan"))((lambda x: (x**2)), max(-2, _x - 4.000000e-4), min(2, _x + 4.000000e-4)))');
  });

  it('reports unknown names and a slope without a plot', () => {
    expect(code(scene('A = {area}'))).toMatch(/EXPORT ERROR: .*\{area\}; use \{x\}, \{y\} or \{slope\}/);
    expect(code(scene('{slope}', false))).toMatch(/EXPORT ERROR: .*\{slope\} needs a function plot/);
  });
});
