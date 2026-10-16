import { describe, expect, it } from 'vitest';
import { createAxes, createExitAnimation, createGraphDotItem, createGraphPlot, createTargetAnimation, defaultSceneDefaults } from '@/store/factories';
import type { ExitAnimStyle, GraphDotItem, SceneItem } from '@/types/scene';
import { exportManimCode } from './manimExporter';
import { exitAnimationExpr, splitTopLevelArgs } from './graphCodegen';

function scene(trace: GraphDotItem['dot']['trace'], exitStyle?: ExitAnimStyle): SceneItem[] {
  const axes = { ...createAxes(defaultSceneDefaults()), id: 'ax', startTime: 0, duration: 1, xRange: [-2, 2, 1], yRange: [0, 4, 1] } as SceneItem;
  const plot = createGraphPlot('ax', 1);
  plot.id = 'p';
  plot.fn = { ...plot.fn, jsExpr: 'x*x', pyExpr: 'x**2' };
  plot.xDomain = [-2, 2];
  const dot = createGraphDotItem('ax', 2);
  dot.id = 'd';
  dot.duration = 0.5;
  dot.dot = { ...dot.dot, label: 'P', showCoordinates: true, attachment: { kind: 'function', graphPlotId: 'p', x: -2 }, trace };
  const follow = createTargetAnimation('graphFollow', ['d'], 3, 2);
  follow.id = 'f';
  follow.targets[0] = { targetId: 'd', targetX: 2, easing: 'linear' };
  const items: SceneItem[] = [axes, plot, dot, follow];
  if (exitStyle) {
    const exit = createExitAnimation(['d'], 6);
    exit.id = 'x';
    exit.targets = exit.targets.map((t) => ({ ...t, animStyle: exitStyle }));
    items.push(exit);
  }
  return items;
}

const code = (items: SceneItem[]) => exportManimCode(items, { fullFile: true, defaults: defaultSceneDefaults() });

describe('dot trail in export', () => {
  it('adds a TracedPath once the dot is on its axes, just under the dot', () => {
    const py = code(scene({ color: '#f59e0b', width: 2 }));
    expect(py).not.toContain('EXPORT ERROR');
    expect(py).toMatch(/(axes_\w+_dot_d)_update\(\(-2, 4\)\)\n\s+\1_trace = TracedPath\(\1\.get_center, stroke_color=ManimColor\("#f59e0b"\), stroke_width=2\)\n\s+self\.add\(\1_trace\)/);
    expect(py).toMatch(/_dot_d_trace\.set_z_index\(\d+\.500000\)/);
  });

  it('fades the tail along the path with a fixed pool of segments', () => {
    const py = code(scene({ fadeSeconds: 1.5 }));
    expect(py).toMatch(/_dot_d_trace = _FadingTrail\(axes_\w+_dot_d\.get_center, 1\.5, ManimColor\("#[0-9a-f]{6}"\), 3\)/i);
    expect(py).toContain('class _FadingTrail(VGroup):');
    expect(py).toContain('seg.set_stroke(opacity=max(0.0, 1.0 - (a0 + a1) / 2 / self._fade))');
    // The class comes before the scene class.
    expect(py.indexOf('class _FadingTrail')).toBeLessThan(py.search(/class \w+\((MovingCamera)?Scene\)/));
    expect(code(scene({}))).not.toContain('_FadingTrail');
    expect(code(scene(undefined))).not.toContain('TracedPath');
  });

  it('takes the coordinates, guides and trail along when the dot exits', () => {
    expect(code(scene({}, 'fade_out'))).toMatch(/FadeOut\((axes_\w+_dot_d), \1_lbl, \1_coord, \1_trace\)/);
    expect(code(scene({}, 'uncreate'))).toMatch(/AnimationGroup\(Uncreate\((axes_\w+_dot_d)\), Uncreate\(\1_lbl\), Uncreate\(\1_coord\), Uncreate\(\1_trace\), lag_ratio=0\)/);
  });

  it('gives single-mobject exits one animation per target', () => {
    expect(splitTopLevelArgs('a, VGroup(b, c), d[0]')).toEqual(['a', 'VGroup(b, c)', 'd[0]']);
    expect(exitAnimationExpr('a', 'shrink_to_center')).toBe('ShrinkToCenter(a)');
    expect(exitAnimationExpr('a, b', 'shrink_to_center')).toBe('AnimationGroup(ShrinkToCenter(a), ShrinkToCenter(b), lag_ratio=0)');
    expect(exitAnimationExpr('a, b', 'fade_out')).toBe('FadeOut(a, b)');
  });
});
