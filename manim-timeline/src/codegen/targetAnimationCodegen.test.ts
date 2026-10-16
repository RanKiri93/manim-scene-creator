import { describe, expect, it } from 'vitest';
import type { SceneItem } from '@/types/scene';
import {
  createCameraMove,
  createAxes,
  createGraphDotItem,
  createGraphCurve,
  createGraphPlot,
  createFrame,
  createImageItem,
  createTargetAnimation,
  createTextLine,
  defaultSceneDefaults,
} from '@/store/factories';
import { formatTargetAnimationClipPlay } from './targetAnimationCodegen';
import { exportManimCode } from './manimExporter';
import { generateGraphDotSnapToAxes } from './graphCodegen';
import { buildGraphAnnotationLayout } from '@/lib/graphAnnotationLayout';

function mapOf(...items: SceneItem[]): Map<string, SceneItem> {
  return new Map(items.map((it) => [it.id, it]));
}

describe('formatTargetAnimationClipPlay', () => {
  it('emits validated graph-space function-x and attached-curve parameter animations at exact clip runtime', () => {
    const axes = createAxes(defaultSceneDefaults(), 0); axes.id = 'ga';
    const plot = createGraphPlot(axes.id, 0); plot.id = 'gp'; plot.fn = { ...plot.fn, jsExpr: 'x*x', pyExpr: 'x**2' };
    const dot = createGraphDotItem(axes.id); dot.id = 'gd'; dot.dot.attachment = { kind: 'function', graphPlotId: plot.id, x: 1 };
    const clip = createTargetAnimation('graphFollow', [dot.id], 1, 2); clip.id = 'follow-x'; clip.targets[0]!.targetX = 3;
    const fn = formatTargetAnimationClipPlay(clip, '', new Map([['ga', 'axes_ga']]), mapOf(axes, plot, dot, clip));
    expect(fn).toContain('UpdateFromAlphaFunc(axes_ga_dot_gd');
    expect(fn).toContain('lambda x: x**2');
    expect(fn).toContain('rate_func=smooth, run_time=2.000000');
    expect(fn).toContain('run_time=2.0000');
    expect(fn).not.toContain('self.wait(');
    dot.dot.showCoordinates = true;
    const partial = exportManimCode([axes, plot, dot, clip], { fullFile: false, defaults: defaultSceneDefaults() });
    expect(partial).toContain('def _graph_update_dot(');
    expect(partial).toContain('_graph_glyphs =');
    expect(partial).toContain('def _graph_update_coordinate(');
    expect(partial).toContain('UpdateFromAlphaFunc(');
    expect(partial).toContain('lambda x: x**2');

    const curve = createGraphCurve(axes.id, 0); curve.id = 'gc'; curve.curve = { ...curve.curve, pyXExpr: 't', pyYExpr: 't**2' };
    dot.dot.attachment = { kind: 'parametric', graphCurveId: curve.id, t: 0.5 };
    const param = createTargetAnimation('graphFollow', [dot.id], 1, 1.25); param.targets[0]!.targetT = 2;
    const tCode = formatTargetAnimationClipPlay(param, '', new Map([['ga', 'axes_ga']]), mapOf(axes, curve, dot, param));
    expect(tCode).toContain('lambda t: t**2');
    expect(tCode).toContain('rate_func=smooth, run_time=1.250000');
  });

  it('places every enabled annotation mobject in the graphFollow animation family without changing runtime', () => {
    for (const label of [false, true]) for (const coordinates of [false, true]) for (const guides of [false, true]) {
      const axes = createAxes(defaultSceneDefaults(), 0); axes.id = 'family_axes';
      const plot = createGraphPlot(axes.id, 0); plot.id = 'family_plot';
      const dot = createGraphDotItem(axes.id); dot.id = `family_${Number(label)}_${Number(coordinates)}_${Number(guides)}`;
      dot.dot.attachment = { kind: 'function', graphPlotId: plot.id, x: 0 };
      dot.dot.label = label ? 'A' : ''; dot.dot.showCoordinates = coordinates; dot.dot.showProjectionGuides = guides;
      const clip = createTargetAnimation('graphFollow', [dot.id], 1, 1.25);
      clip.targets[0]!.targetX = 1;
      const code = formatTargetAnimationClipPlay(clip, '', new Map([[axes.id, 'axes_family']]), mapOf(axes, plot, dot, clip));
      const expectedMobjects = [
        label ? `axes_family_dot_${dot.id}_lbl` : null,
        coordinates ? `axes_family_dot_${dot.id}_coord` : null,
        guides ? `axes_family_dot_${dot.id}_guide_v` : null,
        guides ? `axes_family_dot_${dot.id}_guide_h` : null,
      ].filter((name): name is string => name != null);
      expect(code).toContain('UpdateFromAlphaFunc(axes_family_dot_');
      expect(code.match(/run_time=1\.250000/g)).toHaveLength(expectedMobjects.length + (expectedMobjects.length > 0 ? 2 : 1));
      for (const name of expectedMobjects) expect(code).toContain(`UpdateFromAlphaFunc(${name}, lambda _mob, alpha: None`);
      expect(code.includes('AnimationGroup(')).toBe(expectedMobjects.length > 0);
      expect(code).not.toContain('self.wait(');
    }
  });

  it('rejects free off-curve starts, sampled discontinuities, and conflicting dot writers at export', () => {
    const axes = createAxes(defaultSceneDefaults(), 0); axes.id = 'validation_axes';
    const plot = createGraphPlot(axes.id, 0); plot.id = 'validation_plot'; plot.fn = { ...plot.fn, jsExpr: 'x*x', pyExpr: 'x**2' };
    const freeDot = createGraphDotItem(axes.id); freeDot.id = 'free_dot'; freeDot.dot.dx = 1; freeDot.dot.dy = 4;
    const offCurve = createTargetAnimation('graphFollow', [freeDot.id], 1, 1);
    offCurve.targets[0]!.graphPlotId = plot.id; offCurve.targets[0]!.targetX = 2;
    expect(() => formatTargetAnimationClipPlay(offCurve, '', new Map([[axes.id, 'axes_a']]), mapOf(axes, plot, freeDot, offCurve))).toThrow(/Dot is not on plot/);

    plot.fn = { ...plot.fn, jsExpr: '1/(x-1)', pyExpr: '1/(x-1)' };
    freeDot.dot.dx = 0; freeDot.dot.dy = -1;
    const discontinuous = createTargetAnimation('graphFollow', [freeDot.id], 1, 1);
    discontinuous.targets[0]!.graphPlotId = plot.id; discontinuous.targets[0]!.targetX = 2;
    expect(() => formatTargetAnimationClipPlay(discontinuous, '', new Map([[axes.id, 'axes_a']]), mapOf(axes, plot, freeDot, discontinuous))).toThrow(/undefined|discontinuity/);

    plot.fn = { ...plot.fn, jsExpr: 'x*x', pyExpr: 'x**2' };
    const first = createTargetAnimation('graphFollow', [freeDot.id], 1, 2); first.targets[0]!.graphPlotId = plot.id; first.targets[0]!.targetX = 2;
    const overlapping = createTargetAnimation('move', [freeDot.id], 2, 1);
    expect(() => formatTargetAnimationClipPlay(first, '', new Map([[axes.id, 'axes_a']]), mapOf(axes, plot, freeDot, first, overlapping))).toThrow(/overlap for graph dot/);
  });

  it('exports attached function and parametric dot positions with cached HebrewMathLine annotations', () => {
    const defaults = defaultSceneDefaults();
    const axes = createAxes(defaults, 0); axes.id = 'axes1';
    const plot = createGraphPlot(axes.id, 0); plot.id = 'plot1'; plot.fn = { ...plot.fn, jsExpr: 'x*x', pyExpr: 'x**2' };
    const dot = createGraphDotItem(axes.id); dot.id = 'attached';
    dot.dot.attachment = { kind: 'function', graphPlotId: plot.id, x: 2 };
    dot.dot.label = 'A'; dot.dot.labelFontSize = 21; dot.dot.labelColor = '#ff0000';
    dot.dot.showCoordinates = true; dot.dot.coordinatePrecision = 3; dot.dot.showProjectionGuides = true;
    const code = exportManimCode([axes, plot, dot], { fullFile: true, defaults });
    expect(code).toContain('_update((2, 4))');
    expect(code).toContain('font_size=21, color=ManimColor("#ff0000")');
    expect(code).toContain('axes_1_dot_attached_guide_h, axes_1, UP, 0.15, DOWN, 0.15, 3)');
    expect(code).toContain('_graph_update_dot(axes_1_dot_attached, point, axes_1_dot_attached_lbl, axes_1_dot_attached_coord, axes_1_dot_attached_guide_v, axes_1_dot_attached_guide_h');
    expect(code).not.toContain('True and axes_1_dot_attached_coord or None');
    expect(code).not.toContain('True and axes_1_dot_attached_guide_v or None');
    expect(code).toContain('axes_1_dot_attached_update = lambda point: _graph_update_dot(');
    expect(code).toContain('_graph_glyphs = {c: HebrewMathLine');
    expect(code).toContain('_graph_update_dot(');
    expect(code).toContain('guide_v.put_start_and_end_on');
    expect(code).toContain('np.linalg.norm(v_end - v_start) <= 1e-8');
    expect(code).toContain('guide_v.set_opacity(0)');
    expect(code).toContain('guide_v.set_opacity(1)');
    expect(code).toContain('ink_left = glyph.get_left()[0]');
    expect(code).toContain('ink_right = glyph.get_right()[0]');
    expect(code).toContain('glyph.shift(np.array([cursor - ink_left');
    expect(code).toContain('for char in text:');
    expect(code).toContain('Decimal.from_float(abs(float(value)))');
    expect(code).toContain('glyph_group = _graph_coordinate_glyphs(text, coord._graph_font_size, coord._graph_color)');
    expect(code).toContain('coord.remove(*coord.submobjects)');
    expect(code).toContain('coord.add(*glyph_group.submobjects)');
    expect(code).not.toContain('coord.submobjects =');
    expect(code).not.toContain('coord.arrange(RIGHT');
    expect(code).not.toMatch(/\b(?:Text|Tex|MathTex|DecimalNumber)\s*\(/);
    expect(code).not.toMatch(/updater[\s\S]{0,300}HebrewMathLine\s*\(/);

    const curve = createGraphCurve(axes.id, 0); curve.id = 'curve1'; curve.curve = { ...curve.curve, jsXExpr: 't', jsYExpr: 't*t', pyXExpr: 't', pyYExpr: 't**2' }; curve.tDomain = [0, 3];
    dot.dot.attachment = { kind: 'parametric', graphCurveId: curve.id, t: 1.5 };
    const paramCode = exportManimCode([axes, curve, dot], { fullFile: true, defaults });
    expect(paramCode).toContain('_update((1.5, 2.25))');
  });

  it('formats coordinate strings in deterministic LTR order with preview-compatible precision/sign rounding', () => {
    const dot = createGraphDotItem('axes_format').dot;
    dot.showCoordinates = true; dot.coordinatePrecision = 2;
    const preview = (x: number, y: number) => buildGraphAnnotationLayout({
      dot, point: { x: 0, y: 0 }, coordinate: { x, y }, radiusPx: 4, pxPerUnit: 10,
    }).coordinateText;
    expect(preview(1.125, -0.0001)).toBe('(1.13, 0.00)');
    expect(preview(-0, 0)).toBe('(0.00, 0.00)');
    dot.coordinatePrecision = 3;
    expect(preview(-1.25, 0.707106)).toBe('(-1.250, 0.707)');
  });

  it('routes axes number font size through axis_config without decimal-number duplicate kwargs', () => {
    const axes = createAxes(defaultSceneDefaults(), 0); axes.includeNumbers = true; axes.numberFontSize = 27;
    const code = exportManimCode([axes], { fullFile: true, defaults: defaultSceneDefaults() });
    expect(code).toContain('axis_config={"include_numbers": True, "font_size": 27}');
    expect(code).not.toContain('decimal_number_config": {"font_size": 27');
  });

  it('emits the generic dot updater for plain, label-only and guide-only full/partial exports without a glyph atlas', () => {
    const defaults = defaultSceneDefaults();
    for (const variant of ['plain', 'label', 'guides'] as const) {
      const axes = createAxes(defaults, 0); axes.id = `axes_${variant}`;
      const dot = createGraphDotItem(axes.id); dot.id = `dot_${variant}`;
      if (variant === 'label') dot.dot.label = 'fixed';
      if (variant === 'guides') dot.dot.showProjectionGuides = true;
      for (const fullFile of [true, false]) {
        const code = exportManimCode([axes, dot], { fullFile, defaults });
        expect(code).toContain('def _graph_update_dot(');
        expect(code).toContain(`${dot.id}`);
        expect(code).not.toContain('_graph_glyphs =');
        expect(code).not.toContain('def _graph_coord_text(');
        expect(code).not.toContain('def _graph_update_coordinate(');
        expect(code).not.toContain('_graph_update_coordinate(');
      }
    }
  });

  it('rejects unresolved attached dot sources during export', () => {
    const defaults = defaultSceneDefaults(); const axes = createAxes(defaults, 0); axes.id = 'axes1';
    const dot = createGraphDotItem(axes.id); dot.dot.attachment = { kind: 'function', graphPlotId: 'missing', x: 1 };
    expect(() => generateGraphDotSnapToAxes(dot, 'axes1', 0, [axes, dot], axes)).toThrow(/Attached function plot is missing/);
  });
  it('defers polyline path construction until its delayed camera-cluster branch begins', () => {
    const defaults = defaultSceneDefaults();
    const frame = createFrame(0, 0, 'Home');
    const line = createTextLine(defaults, 0);
    line.id = 'path-target';
    line.raw = 'target';
    line.duration = 4;
    const camera = createCameraMove(frame.id, 0, 4);
    const clip = createTargetAnimation('path', [line.id], 1, 2);
    clip.id = 'delayed-path';
    clip.targets = [{
      targetId: line.id,
      pathKind: 'polyline',
      pathPoints: [{ x: 0, y: 0 }, { x: 2, y: 1 }],
    }];

    const code = exportManimCode([line, camera, clip], {
      fullFile: true,
      defaults,
      frames: [frame],
      startFrameId: frame.id,
    });

    expect(code).toContain('class _DelayedPathGroup(Animation):');
    expect(code).toContain('anchor.get_center() + point[0] * RIGHT + point[1] * UP');
    expect(code).toContain('Succession(Wait(1.0000), _DelayedPathGroup(');
    expect(code).not.toMatch(/_DelayedPathGroup\([\s\S]*run_time=3\.000000\), run_time=2\.0000/);
    expect(code).toContain('run_time=2.000000)');
  });

  it('initializes delayed parametric paths from the live anchor at branch begin', () => {
    const defaults = defaultSceneDefaults();
    const frame = createFrame(0, 0, 'Home');
    const line = createTextLine(defaults, 0);
    line.id = 'parametric-target';
    line.raw = 'target';
    line.duration = 4;
    const camera = createCameraMove(frame.id, 0, 4);
    const clip = createTargetAnimation('path', [line.id], 2, 1);
    clip.targets = [{
      targetId: line.id,
      pathKind: 'parametric',
      parametricPath: {
        jsXExpr: 'Math.cos(t)', jsYExpr: 'Math.sin(t)',
        pyXExpr: 'np.cos(t)', pyYExpr: 'np.sin(t)', tMin: 0, tMax: 3.14,
      },
    }];
    const code = exportManimCode([line, camera, clip], {
      fullFile: true, defaults, frames: [frame], startFrameId: frame.id,
    });
    expect(code).toContain('x0 = fx(t_min)');
    expect(code).toContain('y0 = fy(t_min)');
    expect(code).toContain('(lambda t: np.cos(t))');
    expect(code).toContain('anchor.get_center() + (fx(t) - x0) * RIGHT');
    expect(code).not.toContain('(np.cos(t))(0.000000)');
  });

  it('exports parametric MoveAlongPath relative to target center', () => {
    const line = createTextLine(defaultSceneDefaults(), 0);
    line.id = 'ln1';
    line.segments = [
      { text: 'hi', isMath: false, color: '#ffffff', bold: false, italic: false },
    ];

    const clip = createTargetAnimation('path', [line.id], 1, 2);
    clip.id = 'ta1';
    clip.targets = [
      {
        targetId: line.id,
        pathKind: 'parametric',
        parametricPath: {
          jsXExpr: 'Math.cos(t)',
          jsYExpr: 'Math.sin(t)',
          pyXExpr: 'np.cos(t)',
          pyYExpr: 'np.sin(t)',
          tMin: 0,
          tMax: Math.PI,
        },
      },
    ];

    const code = formatTargetAnimationClipPlay(
      clip,
      '  ',
      new Map([['ln1', 'line_a']]),
      mapOf(line, clip),
    );

    expect(code).toContain('ParametricFunction(');
    expect(code).toContain('line_a.get_center()');
    expect(code).toContain('(np.cos(t))');
    expect(code).toContain('MoveAlongPath(line_a, ta_path_');
  });

  it('exports image move as a shift animation', () => {
    const img = createImageItem({
      srcUrl: 'blob:img',
      fileName: 'img.png',
      mimeType: 'image/png',
      width: 2,
      height: 1,
    });
    img.id = 'img1';
    const clip = createTargetAnimation('move', [img.id], 1, 1.25);
    clip.targets = [{ targetId: img.id, dx: 1.5, dy: -0.25 }];

    const code = formatTargetAnimationClipPlay(
      clip,
      '',
      new Map([['img1', 'image_a']]),
      mapOf(img, clip),
    );

    expect(code).toContain('image_a.animate.shift(1.500000 * RIGHT + -0.250000 * UP)');
    expect(code).toContain('run_time=1.2500');
  });

  it('exports image polyline path as MoveAlongPath', () => {
    const img = createImageItem({
      srcUrl: 'blob:img',
      fileName: 'img.png',
      mimeType: 'image/png',
      width: 2,
      height: 1,
    });
    img.id = 'img1';
    const clip = createTargetAnimation('path', [img.id], 1, 2);
    clip.id = 'ta_img_path';
    clip.targets = [
      {
        targetId: img.id,
        pathKind: 'polyline',
        pathPoints: [
          { x: 0, y: 0 },
          { x: 1, y: 0.5 },
        ],
      },
    ];

    const code = formatTargetAnimationClipPlay(
      clip,
      '',
      new Map([['img1', 'image_a']]),
      mapOf(img, clip),
    );

    expect(code).toContain('image_a.get_center()');
    expect(code).toContain('set_points_as_corners');
    expect(code).toContain('MoveAlongPath(image_a, ta_path_');
  });

  it('exports image rotate through the image var', () => {
    const img = createImageItem({
      srcUrl: 'blob:img',
      fileName: 'img.png',
      mimeType: 'image/png',
      width: 2,
      height: 1,
    });
    img.id = 'img1';
    const clip = createTargetAnimation('rotate', [img.id], 1, 0.75);
    clip.targets = [{ targetId: img.id, angleDeg: 45 }];

    const code = formatTargetAnimationClipPlay(
      clip,
      '',
      new Map([['img1', 'image_a']]),
      mapOf(img, clip),
    );

    expect(code).toContain('image_a.animate.rotate(45.000000 * DEGREES)');
    expect(code).toContain('run_time=0.7500');
  });
});
