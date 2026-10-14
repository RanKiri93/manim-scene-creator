import { describe, expect, it } from 'vitest';
import { exportManimCode } from './manimExporter';
import { AUDIO_BINDING_NONE } from '@/lib/audioBinding';
import {
  createAxes,
  createExitAnimation,
  createGraphCurve,
  createGraphPlot,
  createCameraMove,
  createFrame,
  createGraphDotItem,
  createImageItem,
  createShape,
  createSurroundingRect,
  createTextLine,
  createTargetAnimation,
  defaultSceneDefaults,
} from '@/store/factories';

const seg = (text: string) =>
  ({
    text,
    isMath: true,
    color: '#ffffff',
    bold: false,
    italic: false,
  }) as const;

function createTestImage(startTime = 0) {
  const img = createImageItem({
    srcUrl: 'blob:test-image',
    fileName: 'still.png',
    mimeType: 'image/png',
    width: 2,
    height: 1,
    startTime,
  });
  img.id = `img_${startTime}`;
  img.assetRelPath = `assets/textures/still_${startTime}.png`;
  return img;
}

describe('exportManimCode concurrent overlap (composable leaves)', () => {
  it('chains function-x graphFollow clips across a one-second hold with exact cursor waits', () => {
    const defaults = defaultSceneDefaults();
    const axes = createAxes(defaults, 0); axes.id = 'chain_fn_axes'; axes.visibleAtSceneStart = true;
    const plot = createGraphPlot(axes.id, 0); plot.id = 'chain_fn_plot'; plot.visibleAtSceneStart = true;
    const dot = createGraphDotItem(axes.id, 0); dot.id = 'chain_fn_dot'; dot.visibleAtSceneStart = true;
    dot.dot.label = 'P'; dot.dot.showCoordinates = true; dot.dot.showProjectionGuides = true;
    dot.dot.attachment = { kind: 'function', graphPlotId: plot.id, x: 0 };
    const first = { ...createTargetAnimation('graphFollow', [dot.id], 1, 1), id: 'chain_fn_first' };
    first.targets[0]!.targetX = 2;
    const second = { ...createTargetAnimation('graphFollow', [dot.id], 3, 1), id: 'chain_fn_second' };
    second.targets[0]!.targetX = 3;
    const next = createTextLine(defaults, 5); next.id = 'chain_fn_end'; next.raw = 'end'; next.duration = 0.5;
    const code = exportManimCode([axes, plot, dot, first, second, next], { fullFile: true, defaults });
    expect(code).toContain('((0) + (((2) - (0)) * alpha))');
    expect(code).toContain('((2) + (((3) - (2)) * alpha))');
    expect(code.match(/run_time=1\.0000\)/g)).toHaveLength(2);
    // Absolute targets: clip 1 at t=1, clip 2 at t=3, then hold to the line at t=5.
    expect(code.match(/_wait_to\(self, [\d.]+\)/g)).toEqual([
      '_wait_to(self, 1.0000)', '_wait_to(self, 3.0000)', '_wait_to(self, 5.0000)',
    ]);
    expect(code.match(/UpdateFromAlphaFunc\(axes_1_dot_chain_fn_dot_coord, lambda _mob, alpha: None/g)).toHaveLength(2);
    expect(code.match(/UpdateFromAlphaFunc\(axes_1_dot_chain_fn_dot_guide_v, lambda _mob, alpha: None/g)).toHaveLength(2);
  });

  it('chains attached-parametric graphFollow clips across a one-second hold with exact cursor waits', () => {
    const defaults = defaultSceneDefaults();
    const axes = createAxes(defaults, 0); axes.id = 'chain_t_axes'; axes.visibleAtSceneStart = true;
    const curve = createGraphCurve(axes.id, 0); curve.id = 'chain_t_curve'; curve.visibleAtSceneStart = true;
    curve.curve = { ...curve.curve, jsXExpr: 't', jsYExpr: 't*t', pyXExpr: 't', pyYExpr: 't**2' };
    const dot = createGraphDotItem(axes.id, 0); dot.id = 'chain_t_dot'; dot.visibleAtSceneStart = true;
    dot.dot.label = 'P'; dot.dot.showCoordinates = true; dot.dot.showProjectionGuides = true;
    dot.dot.attachment = { kind: 'parametric', graphCurveId: curve.id, t: 0.5 };
    const first = { ...createTargetAnimation('graphFollow', [dot.id], 1, 1), id: 'chain_t_first' };
    first.targets[0]!.targetT = 1.5;
    const second = { ...createTargetAnimation('graphFollow', [dot.id], 3, 1), id: 'chain_t_second' };
    second.targets[0]!.targetT = 2.5;
    const next = createTextLine(defaults, 5); next.id = 'chain_t_end'; next.raw = 'end'; next.duration = 0.5;
    const code = exportManimCode([axes, curve, dot, first, second, next], { fullFile: true, defaults });
    expect(code).toContain('((0.5) + (((1.5) - (0.5)) * alpha))');
    expect(code).toContain('((1.5) + (((2.5) - (1.5)) * alpha))');
    expect(code.match(/run_time=1\.0000\)/g)).toHaveLength(2);
    expect(code.match(/_wait_to\(self, [\d.]+\)/g)).toEqual([
      '_wait_to(self, 1.0000)', '_wait_to(self, 3.0000)', '_wait_to(self, 5.0000)',
    ]);
    expect(code.match(/UpdateFromAlphaFunc\(axes_1_dot_chain_t_dot_coord, lambda _mob, alpha: None/g)).toHaveLength(2);
    expect(code.match(/UpdateFromAlphaFunc\(axes_1_dot_chain_t_dot_guide_h, lambda _mob, alpha: None/g)).toHaveLength(2);
  });

  it('keeps delayed graphFollow, camera, and an overlapping leaf in one concurrent export', () => {
    const defaults = defaultSceneDefaults();
    const home = createFrame(0, 0, 'Home'); const right = createFrame(1, 0, 'Right');
    const axes = createAxes(defaults, 0); axes.id = 'camera_follow_axes'; axes.visibleAtSceneStart = true;
    const plot = createGraphPlot(axes.id, 0); plot.id = 'camera_follow_plot'; plot.visibleAtSceneStart = true;
    const dot = createGraphDotItem(axes.id, 0); dot.id = 'camera_follow_dot'; dot.visibleAtSceneStart = true;
    dot.dot.attachment = { kind: 'function', graphPlotId: plot.id, x: 0 };
    const follow = { ...createTargetAnimation('graphFollow', [dot.id], 1, 2), id: 'camera_follow_clip' };
    follow.targets[0]!.targetX = 2;
    const camera = createCameraMove(right.id, 0, 3);
    const line = createTextLine(defaults, 2); line.id = 'camera_follow_leaf'; line.raw = 'overlap'; line.duration = 1;
    const code = exportManimCode([axes, plot, dot, follow, camera, line], {
      fullFile: true, defaults, frames: [home, right], startFrameId: home.id,
    });
    expect(code).toContain('class _CameraPoseAnimation(Animation):');
    expect(code).toContain('UpdateFromAlphaFunc(axes_1_dot_camera_follow_dot');
    expect(code).toContain('Succession(Wait(1.0000), UpdateFromAlphaFunc');
    expect(code).toContain('AnimationGroup(');
  });

  it('keeps a labeled graph-dot intro and early graphFollow on one shared timed cluster', () => {
    const defaults = defaultSceneDefaults();
    const axes = createAxes(defaults, 0); axes.id = 'early_axes'; axes.visibleAtSceneStart = true;
    const plot = createGraphPlot(axes.id, 0); plot.id = 'early_plot'; plot.visibleAtSceneStart = true;
    const dot = createGraphDotItem(axes.id, 0); dot.id = 'early_dot'; dot.duration = 0.4;
    dot.dot.label = 'A'; dot.dot.showCoordinates = true; dot.dot.showProjectionGuides = true;
    dot.dot.attachment = { kind: 'function', graphPlotId: plot.id, x: 1 };
    const follow = { ...createTargetAnimation('graphFollow', [dot.id], 0.2, 1), id: 'early_follow' };
    follow.targets[0]!.targetX = 2;
    const next = createTextLine(defaults, 3); next.id = 'after_early'; next.raw = 'after'; next.duration = 0.5;
    const code = exportManimCode([axes, plot, dot, follow, next], { fullFile: true, defaults });
    // Dot, annotations and label come in together inside the 0.4 s clip.
    expect(code).toContain(
      'Succession(Wait(0.0000), AnimationGroup(FadeIn(axes_1_dot_early_dot, run_time=0.400000), ' +
      'FadeIn(axes_1_dot_early_dot_coord, run_time=0.400000), FadeIn(axes_1_dot_early_dot_guide_v, run_time=0.400000), ' +
      'FadeIn(axes_1_dot_early_dot_guide_h, run_time=0.400000), Write(axes_1_dot_early_dot_lbl, run_time=0.400000), ' +
      'lag_ratio=0, run_time=0.400000))',
    );
    expect(code).toContain('Succession(Wait(0.2000), AnimationGroup(UpdateFromAlphaFunc');
    expect(code).toContain('UpdateFromAlphaFunc(axes_1_dot_early_dot_coord, lambda _mob, alpha: None');
    expect(code).toContain('UpdateFromAlphaFunc(axes_1_dot_early_dot_guide_h, lambda _mob, alpha: None');
    expect(code.match(/axes_1_dot_early_dot_coord/g)?.length).toBeGreaterThan(1); // existing mobject is referenced by intro and motion, not reconstructed
    expect(code).toContain('run_time=1.000000');
    // Hand timeline: dot 0..0.4, follow 0.2..1.2, so the cluster runs 1.2 s; next event at 3 s.
    expect(code).toContain('), run_time=1.2000)');
    expect(code).toContain('_wait_to(self, 3.0000)');
  });

  it('writes a labelled graph-dot label inside the clip when the dot plays on its own', () => {
    const defaults = defaultSceneDefaults();
    const axes = createAxes(defaults, 0); axes.id = 'solo_axes'; axes.visibleAtSceneStart = true;
    const dot = createGraphDotItem(axes.id, 0); dot.id = 'solo_dot'; dot.duration = 0.4;
    dot.dot.label = 'A'; dot.dot.showCoordinates = true;
    const next = createTextLine(defaults, 0.8); next.id = 'after_solo'; next.raw = 'after'; next.duration = 0.5;
    const code = exportManimCode([axes, dot, next], { fullFile: true, defaults });
    expect(code).toContain(
      'self.play(AnimationGroup(FadeIn(axes_1_dot_solo_dot), FadeIn(axes_1_dot_solo_dot_coord), ' +
      'Write(axes_1_dot_solo_dot_lbl), lag_ratio=0), run_time=0.4)',
    );
    expect(code).not.toContain('self.play(Write(axes_1_dot_solo_dot_lbl))');
    expect(code).not.toContain('self.add(axes_1_dot_solo_dot_coord)');
    // Hand timeline: dot 0..0.4 (label included), line at 0.8.
    expect(code).toContain('_wait_to(self, 0.8000)');
  });

  it('starts a labelled graph-dot audio tail at the end of its run time, not a second later', () => {
    const defaults = defaultSceneDefaults();
    const axes = createAxes(defaults, 0); axes.id = 'tail_axes'; axes.visibleAtSceneStart = true;
    const dot = createGraphDotItem(axes.id, 0); dot.id = 'tail_dot'; dot.duration = 1;
    dot.dot.label = 'P';
    dot.audioTrackId = 'dot-audio';
    const code = exportManimCode([axes, dot], {
      fullFile: true,
      defaults,
      audioItems: [{
        id: 'dot-audio', text: 'p', audioUrl: '/assets/audio/p.webm',
        assetRelPath: 'assets/audio/p.webm', startTime: 0, duration: 3,
      }],
    });
    expect(code).toContain('Write(axes_1_dot_tail_dot_lbl), lag_ratio=0), run_time=1.000000)');
    // Hand timeline: 1 s intro (label inside), file runs to 3 s, so the tail is 2 s.
    expect(code).toContain('self.wait(2.0000)');
  });

  it('keeps graph-follow duration aligned with hand-derived waits to the next event', () => {
    const defaults = defaultSceneDefaults();
    const axes = createAxes(defaults, 0); axes.id = 'follow_axes'; axes.visibleAtSceneStart = true;
    const plot = createGraphPlot(axes.id, 0); plot.id = 'follow_plot'; plot.visibleAtSceneStart = true;
    const dot = createGraphDotItem(axes.id, 0); dot.id = 'follow_dot'; dot.duration = 1;
    dot.dot.attachment = { kind: 'function', graphPlotId: plot.id, x: 1 };
    const follow = { ...createTargetAnimation('graphFollow', [dot.id], 2, 2), id: 'follow_clip' };
    follow.targets[0]!.targetX = 3;
    const concurrent = createTextLine(defaults, 3); concurrent.id = 'during_follow'; concurrent.raw = 'concurrent'; concurrent.duration = 1;
    const next = createTextLine(defaults, 6); next.id = 'after_follow'; next.raw = 'after'; next.duration = 1;
    const code = exportManimCode([axes, plot, dot, follow, concurrent, next], { fullFile: true, defaults });
    expect(code).toContain('_wait_to(self, 2.0000)'); // timeline: dot 0..1, follow begins at 2
    expect(code).toContain('run_time=2.000000');
    expect(code).toContain('UpdateFromAlphaFunc(axes_1_dot_follow_dot');
    expect(code).toContain('AnimationGroup(');
    expect(code).toContain('_wait_to(self, 6.0000)'); // follow ends at 4, next event starts at 6
  });

  it('exports frame placement and camera move with MovingCameraScene', () => {
    const defaults = defaultSceneDefaults();
    const home = createFrame(0, 0, 'Home');
    const right = createFrame(1, 0, 'Right');
    const line = createTextLine(defaults, 0);
    line.raw = 'hello';
    line.frameId = right.id;
    const cam = createCameraMove(right.id, 2, 1.5);

    const code = exportManimCode([line, cam], {
      fullFile: true,
      defaults,
      frames: [home, right],
      startFrameId: home.id,
    });

    expect(code).toContain('class Scene1(MovingCameraScene):');
    expect(code).toContain('VGroup(line_1).shift(14.222222 * RIGHT)');
    expect(code).toContain(
      '_CameraPoseAnimation(self.camera.frame, (0.000000, 0.000000, 14.222222), [(2.000000, 3.500000, 3.500000, (0.000000, 0.000000, 14.222222), (14.222222, 0.000000, 14.222222))], run_time=3.500000)',
    );
    expect(code).toContain('self.camera.frame.set(width=14.222222)');
  });

  it('runs a delayed camera branch concurrently with the object and pads exactly to the next event', () => {
    const defaults = defaultSceneDefaults();
    const home = createFrame(0, 0, 'Home');
    const shape = createShape(0);
    shape.id = 'object_0_4';
    shape.duration = 4;
    const camera = createCameraMove(home.id, 1, 2);
    camera.targetWidth = 7.111111;
    camera.offsetX = 2;
    const next = createTextLine(defaults, 6);
    next.raw = 'next';
    next.duration = 1;

    const code = exportManimCode([shape, camera, next], {
      fullFile: true,
      defaults,
      frames: [home],
      startFrameId: home.id,
    });

    // Hand timeline: object 0..4 contains camera 1..3; cluster wall is 4s; next starts at 6.
    expect(code).toContain('[(1.000000, 3.000000, 3.000000, (0.000000, 0.000000, 14.222222), (2.000000, 0.000000, 7.111111))]');
    expect(code).toContain('run_time=4.000000)');
    expect(code).toMatch(/self\.play\(AnimationGroup\([\s\S]*?run_time=4\.0000\)/);
    expect(code).toContain('_wait_to(self, 6.0000)');
    expect(code).not.toContain('frame.animate.move_to');
  });

  it('exports overlapping camera commands as one writer using the shared interrupted pose and keeps authored scene end', () => {
    const defaults = defaultSceneDefaults();
    const home = createFrame(0, 0, 'Home');
    const a = createCameraMove(home.id, 0, 10);
    a.id = 'a';
    a.offsetX = 10;
    const b = createCameraMove(home.id, 2, 1);
    b.id = 'b';
    b.offsetX = 4;
    b.targetWidth = 6;

    const code = exportManimCode([a, b], {
      fullFile: true,
      defaults,
      frames: [home],
      startFrameId: home.id,
    });

    // Hand timeline: A's eased progress at 2/10 is .104; B begins there, ends at 3, holds to 10.
    expect(code).toContain('(0.000000, 10.000000, 2.000000, (0.000000, 0.000000, 14.222222), (10.000000, 0.000000, 14.222222))');
    expect(code).toContain('(2.000000, 3.000000, 3.000000, (1.040000, 0.000000, 14.222222), (4.000000, 0.000000, 6.000000))');
    expect(code).toContain('run_time=10.000000)');
    expect(code.match(/_CameraPoseAnimation\(/g)).toHaveLength(2); // class declaration + one animation
    expect(code).not.toContain('_wait_to('); // one camera branch itself consumes the authored 10s span
    expect(code).not.toContain('self.play(self.camera.frame.animate');
  });

  it('keeps a scheduled return at its authored time and returns to absolute full-frame width', () => {
    const defaults = defaultSceneDefaults();
    const home = createFrame(1, 1, 'Home');
    const zoom = createCameraMove(home.id, 5, 1);
    zoom.targetWidth = 5;
    zoom.offsetX = 2;
    const back = createCameraMove(home.id, 9, 1);
    const shape = createShape(0);
    shape.duration = 12;
    const code = exportManimCode([shape, zoom, back], {
      fullFile: true,
      defaults,
      frames: [home],
      startFrameId: home.id,
    });
    // Timeline hand-check: 0..12 object cluster contains zoom 5..6 and return 9..10.
    expect(code).toContain('(5.000000, 6.000000, 6.000000');
    expect(code).toContain('(9.000000, 10.000000, 10.000000');
    expect(code).toContain('(14.222222, -8.000000, 14.222222)');
    expect(code).toContain('run_time=12.000000)');
    expect(code).not.toContain('frame.animate.move_to');
  });

  it('lets an authored return interrupt B continuously and holds full frame through B’s authored scene tail', () => {
    const defaults = defaultSceneDefaults();
    const frame = createFrame(0, 0, 'Home');
    const object = createShape(0);
    object.duration = 12;
    const a = createCameraMove(frame.id, 5, 1);
    a.targetWidth = 5;
    a.offsetX = 2;
    const b = createCameraMove(frame.id, 7, 4);
    b.id = 'b';
    b.targetWidth = 8;
    b.offsetX = 8;
    const back = createCameraMove(frame.id, 9, 1);
    back.id = 'return';
    const code = exportManimCode([object, a, b, back], {
      fullFile: true, defaults, frames: [frame], startFrameId: frame.id,
    });
    // At t=9 B is halfway through its four-second cubic transition: ease(.5)=.5,
    // so the return starts at x=5,width=6.5 and the authored object ends at t=12.
    expect(code).toContain('(7.000000, 11.000000, 9.000000, (2.000000, 0.000000, 5.000000), (8.000000, 0.000000, 8.000000))');
    expect(code).toContain('(9.000000, 10.000000, 10.000000, (5.000000, 0.000000, 6.500000), (0.000000, 0.000000, 14.222222))');
    expect(code).toContain('run_time=12.000000)');
    expect(code).not.toContain('_wait_to(');
  });

  it('emits exact waits and run times for a delayed camera-only clip and keeps touching intervals separate', () => {
    const defaults = defaultSceneDefaults();
    const frame = createFrame(0, 0, 'Home');
    const delayed = createCameraMove(frame.id, 2, 1);
    const solo = exportManimCode([delayed], {
      fullFile: true, defaults, frames: [frame], startFrameId: frame.id,
    });
    expect(solo).toContain('_wait_to(self, 2.0000)');
    expect(solo).toContain('run_time=1.000000)');
    expect(solo).not.toContain('_wait_to(self, 3.0000)'); // the camera clip itself ends the scene

    const first = createCameraMove(frame.id, 0, 1);
    const second = createCameraMove(frame.id, 1, 1);
    const touching = exportManimCode([first, second], {
      fullFile: true, defaults, frames: [frame], startFrameId: frame.id,
    });
    expect(touching.match(/self\.play\(_CameraPoseAnimation\(/g)).toHaveLength(2);
    expect(touching).toContain('run_time=1.000000)');
    expect(touching).not.toContain('AnimationGroup(');
  });

  it('uses only the shared schedule equal-start winner, independent of input order', () => {
    const defaults = defaultSceneDefaults();
    const frame = createFrame(0, 0, 'Home');
    const loser = createCameraMove(frame.id, 1, 2);
    loser.id = 'a-loser';
    loser.offsetX = 2;
    const winner = createCameraMove(frame.id, 1, 1);
    winner.id = 'z-winner';
    winner.offsetX = 7;
    const code = exportManimCode([winner, loser], {
      fullFile: true, defaults, frames: [frame], startFrameId: frame.id,
    });
    expect(code).toContain('(7.000000, 0.000000, 14.222222)');
    expect(code).not.toContain('(2.000000, 0.000000, 14.222222)');
    expect(code.match(/_CameraPoseAnimation\(self\.camera\.frame/g)).toHaveLength(1);
  });

  it('preserves distinct sub-millisecond camera starts instead of event-grouping their schedule', () => {
    const defaults = defaultSceneDefaults();
    const frame = createFrame(0, 0, 'Home');
    const first = createCameraMove(frame.id, 1, 1);
    first.id = 'a';
    first.offsetX = 4;
    const second = createCameraMove(frame.id, 1.0005, 1);
    second.id = 'b';
    second.offsetX = 8;
    const code = exportManimCode([first, second], {
      fullFile: true, defaults, frames: [frame], startFrameId: frame.id,
    });
    expect(code).toContain('(0.000000, 1.000000, 0.000500');
    expect(code).toContain('(0.000500, 1.000500, 1.000500');
    expect(code).toContain('(4.000000, 0.000000, 14.222222)');
    expect(code).toContain('(0.000003, 0.000000, 14.222222)');
    expect(code).toContain('run_time=1.000500)');
  });

  it('schedules an unbound audio start inside a blocking camera cluster exactly once with its offset', () => {
    const defaults = defaultSceneDefaults();
    const frame = createFrame(0, 0, 'Home');
    const camera = createCameraMove(frame.id, 0, 4);
    const cameraB = createCameraMove(frame.id, 1, 2);
    cameraB.offsetX = 1;
    const track = {
      id: 'interior-audio', text: 'audio', audioUrl: '/assets/audio/voice.webm',
      assetRelPath: 'assets/audio/voice.webm', startTime: 2, duration: 1,
    };
    const code = exportManimCode([camera, cameraB], {
      fullFile: true, defaults, frames: [frame], startFrameId: frame.id,
      audioItems: [track],
    });
    expect(code).toContain('self.add_sound("assets/audio/voice.webm", time_offset=2.0000)');
    expect(code.match(/self\.add_sound\(/g)).toHaveLength(1);
    expect(code).toContain('run_time=4.0000)');
  });

  it('rejects cross-frame next_to exports', () => {
    const defaults = defaultSceneDefaults();
    const home = createFrame(0, 0, 'Home');
    const right = createFrame(1, 0, 'Right');
    const a = createTextLine(defaults, 0);
    a.id = 'a';
    a.frameId = home.id;
    a.raw = 'a';
    const b = createTextLine(defaults, 1);
    b.id = 'b';
    b.frameId = right.id;
    b.raw = 'b';
    b.posSteps = [
      {
        kind: 'next_to',
        refKind: 'line',
        refId: a.id,
        dir: 'DOWN',
        buff: 0.3,
        alignedEdge: null,
        refSegmentIndex: null,
        selfSegmentIndex: null,
        bounds: null,
      },
    ];

    const code = exportManimCode([a, b], {
      fullFile: true,
      defaults,
      frames: [home, right],
      startFrameId: home.id,
    });
    expect(code).toContain('EXPORT ERROR');
    expect(code).toContain('different frame');
  });

  it('emits graph plot() after axes positioning so coords_to_point uses the final pose', () => {
    const defaults = defaultSceneDefaults();
    const ax = createAxes(defaults, 0);
    ax.x = 2.5;
    ax.y = -1.25;
    const plot = createGraphPlot(ax.id, 0);
    plot.fn.pyExpr = 'x';

    const code = exportManimCode([ax, plot], {
      fullFile: true,
      defaults,
      audioItems: [],
    });

    const defStart = code.indexOf('# ========== 1. Definitions ==========');
    const posStart = code.indexOf('# ========== 2. Positioning ==========');
    const playStart = code.indexOf('# ========== 3. Playback ==========');
    expect(defStart).toBeGreaterThan(-1);
    expect(posStart).toBeGreaterThan(-1);
    expect(playStart).toBeGreaterThan(-1);

    const defBlock = code.slice(defStart, posStart);
    const posBlock = code.slice(posStart, playStart);
    expect(defBlock).not.toMatch(/\.plot\(/);
    expect(posBlock).toMatch(/\.plot\(/);
    expect(posBlock.indexOf('.move_to(')).toBeLessThan(posBlock.indexOf('.plot('));
  });

  it('emits ParametricFunction after axes positioning with t_range and Create(curve)', () => {
    const defaults = defaultSceneDefaults();
    const ax = createAxes(defaults, 0);
    ax.x = -1;
    ax.y = 2;
    const curve = createGraphCurve(ax.id, 0);
    curve.curve.pyXExpr = 'np.cos(t)';
    curve.curve.pyYExpr = 'np.sin(t)';
    curve.tDomain = [0, 6.283];

    const code = exportManimCode([ax, curve], {
      fullFile: true,
      defaults,
      audioItems: [],
    });

    const defStart = code.indexOf('# ========== 1. Definitions ==========');
    const posStart = code.indexOf('# ========== 2. Positioning ==========');
    const playStart = code.indexOf('# ========== 3. Playback ==========');
    const defBlock = code.slice(defStart, posStart);
    const posBlock = code.slice(posStart, playStart);
    const playBlock = code.slice(playStart);

    expect(defBlock).not.toMatch(/ParametricFunction\(/);
    expect(posBlock).toContain('ParametricFunction(');
    expect(posBlock.indexOf('.move_to(')).toBeLessThan(
      posBlock.indexOf('ParametricFunction('),
    );
    expect(posBlock).toMatch(/t_range=\[\s*0/);
    expect(posBlock).toMatch(/coords_to_point\(/);
    expect(posBlock).toContain('.set_stroke(width=');
    expect(playBlock).toContain('Create(');
    expect(playBlock).toMatch(/Create\([^,)]+curve_/);
    expect(playBlock).toMatch(/run_time=1[\d.]*\)/);
  });

  it('emits plot x_range when graph plot has xDomain', () => {
    const defaults = defaultSceneDefaults();
    const ax = createAxes(defaults, 0);
    const plot = createGraphPlot(ax.id, 0);
    plot.fn.pyExpr = 'x';
    plot.xDomain = [0, 2];

    const code = exportManimCode([ax, plot], {
      fullFile: true,
      defaults,
      audioItems: [],
    });

    expect(code).toContain('x_range=[0, 2]');
  });

  it('sets plot curve width via set_stroke after plot()', () => {
    const defaults = defaultSceneDefaults();
    const ax = createAxes(defaults, 0);
    const plot = createGraphPlot(ax.id, 0);
    plot.fn.pyExpr = 'x';
    plot.strokeWidth = 6;

    const code = exportManimCode([ax, plot], {
      fullFile: true,
      defaults,
      audioItems: [],
    });

    expect(code).toContain('.set_stroke(width=6)');
  });

  it('merges two overlapping lines into one AnimationGroup with staggered Succession', () => {
    const defaults = defaultSceneDefaults();
    const a = createTextLine(defaults, 50);
    a.duration = 3;
    a.raw = 'A';
    a.segments = [seg('A')];
    const b = createTextLine(defaults, 51);
    b.duration = 2;
    b.raw = 'B';
    b.segments = [seg('B')];

    const code = exportManimCode([a, b], {
      fullFile: false,
      defaults,
      audioItems: [],
    });

    expect(code).toContain('AnimationGroup(');
    expect(code).toContain('Succession(Wait(0.0000), Write(');
    expect(code).toContain('Succession(Wait(1.0000), Write(');
    expect(code).toMatch(/run_time=3\.0000\)/);
  });

  it('merges two lines with the same start into one AnimationGroup', () => {
    const defaults = defaultSceneDefaults();
    const a = createTextLine(defaults, 10);
    a.duration = 3;
    a.raw = 'A';
    a.segments = [seg('A')];
    const b = createTextLine(defaults, 10);
    b.duration = 3;
    b.raw = 'B';
    b.segments = [seg('B')];

    const code = exportManimCode([a, b], {
      fullFile: false,
      defaults,
      audioItems: [],
    });

    expect(code).toContain('AnimationGroup(');
    expect(code).toMatch(/run_time=3\.0000\)/);
  });

  it('merges overlapping text line and surrounding rect into one AnimationGroup', () => {
    const defaults = defaultSceneDefaults();
    const line = createTextLine(defaults, 54);
    line.duration = 3;
    line.raw = 'ODE';
    line.segments = [seg('ODE')];
    const sr = createSurroundingRect([line.id], 56);

    const code = exportManimCode([line, sr], {
      fullFile: false,
      defaults,
      audioItems: [],
    });

    expect(code).toContain('AnimationGroup(');
    expect(code).toContain('Succession(Wait(0.0000), Write(');
    expect(code).toContain('Succession(Wait(2.0000), Create(');
    expect(code).not.toMatch(
      /Write\([^)]+\), run_time=[\d.]+\)\s*\n\s*self\.play\(Create\(sr_/,
    );
  });

  it('image leaf followed by a later line preserves the exact timeline wait', () => {
    const defaults = defaultSceneDefaults();
    const image = createTestImage(0);
    image.duration = 1.5;
    const line = createTextLine(defaults, 3);
    line.raw = 'Later';
    line.segments = [seg('Later')];
    line.duration = 1;

    const code = exportManimCode([image, line], {
      fullFile: false,
      defaults,
      audioItems: [],
    });

    expect(code).toContain('self.play(FadeIn(image_1), run_time=1.500000)');
    // Timeline by hand: image consumes 0..1.5, line starts at 3.0, so wait until 3.0.
    expect(code).toContain('_wait_to(self, 3.0000)');
    expect(code.indexOf('_wait_to(self, 3.0000)')).toBeLessThan(code.indexOf('Write('));
  });

  it('rejects unbundled blob image paths instead of emitting a missing texture path', () => {
    const defaults = defaultSceneDefaults();
    const image = createTestImage(0);
    image.assetRelPath = undefined;
    image.srcUrl = 'blob:temporary';

    const code = exportManimCode([image], {
      fullFile: false,
      defaults,
      audioItems: [],
    });

    expect(code).toContain('EXPORT ERROR');
    expect(code).toContain('not bundled for Manim export');
    expect(code).not.toContain('ImageMobject("assets/textures/');
  });

  it('merges overlapping image and shape into one AnimationGroup with staggered branches', () => {
    const defaults = defaultSceneDefaults();
    const image = createTestImage(0);
    image.duration = 2;
    const shape = createShape(0.5);
    shape.duration = 1.5;

    const code = exportManimCode([image, shape], {
      fullFile: false,
      defaults,
      audioItems: [],
    });

    expect(code).toContain('AnimationGroup(');
    expect(code).toContain('Succession(Wait(0.0000), FadeIn(image_1, run_time=2.000000))');
    expect(code).toContain('Succession(Wait(0.5000), Create(shape_1), run_time=1.500000)');
    // The delayed image/shape cluster wall is 2.0s. The image branch's FadeIn keeps
    // its full 2.0s run_time instead of sharing that branch run_time with Wait(rel).
    expect(code).not.toContain('Succession(Wait(0.0000), FadeIn(image_1), run_time=2.000000)');
    expect(code).toMatch(/run_time=2\.0000\)/);
  });

  it('does not compress a delayed concurrent image FadeIn into its relative wait', () => {
    const defaults = defaultSceneDefaults();
    const shape = createShape(0);
    shape.duration = 2;
    const image = createTestImage(0.5);
    image.duration = 1.5;

    const code = exportManimCode([shape, image], {
      fullFile: false,
      defaults,
      audioItems: [],
    });

    // Timeline by hand: image waits 0.5s relative to the cluster then fades for 1.5s.
    // The branch must not put run_time=1.5 on the whole Succession (which would compress FadeIn to 1.0s).
    expect(code).toContain('Succession(Wait(0.5000), FadeIn(image_1, run_time=1.500000))');
    expect(code).not.toContain('Succession(Wait(0.5000), FadeIn(image_1), run_time=1.500000)');
    expect(code).toMatch(/AnimationGroup\([\s\S]*run_time=2\.0000\)/);
  });

  it('does not compress an image bound-audio tail inside a concurrent cluster', () => {
    const defaults = defaultSceneDefaults();
    const image = createTestImage(0);
    image.duration = 1;
    image.audioTrackId = 'narr';
    const shape = createShape(0);
    shape.duration = 1;

    const code = exportManimCode([image, shape], {
      fullFile: false,
      defaults,
      audioItems: [
        {
          id: 'narr',
          text: 'audio',
          audioUrl: '/assets/audio/narr.webm',
          assetRelPath: 'assets/audio/narr.webm',
          startTime: 0,
          duration: 3,
        },
      ],
    });

    // Timeline by hand: image animation runs 1s, bound file lasts 3s, tail wait = 2s.
    // The outer concurrent AnimationGroup must therefore consume 3s, not the 1s visual wall.
    expect(code).toContain('FadeIn(image_1, run_time=1.000000), Wait(2.000000)');
    expect(code).toMatch(/AnimationGroup\([\s\S]*run_time=3\.0000\)/);
  });

  it('uses HebrewMathLine for graph dot and surrounding-rectangle labels', () => {
    const defaults = defaultSceneDefaults();
    const ax = createAxes(defaults, 0);
    const plot = createGraphPlot(ax.id, 0);
    plot.fn.pyExpr = 'x';
    const dot = createGraphDotItem(ax.id, 0);
    dot.dot.label = 'נקודה';
    const sr = createSurroundingRect([ax.id], 0);
    sr.labelText = 'מסגרת';

    const code = exportManimCode([ax, plot, dot, sr], {
      fullFile: true,
      defaults,
      audioItems: [],
    });

    expect(code).toContain('HebrewMathLine("מסגרת"');
    expect(code).toContain('HebrewMathLine("נקודה"');
    expect(code).not.toContain('Text(');
    expect(code).not.toContain('Tex(');
    expect(code).not.toContain('MathTex(');
  });

  it('surrounding rect on text line segments uses VGroup of submobjects', () => {
    const defaults = defaultSceneDefaults();
    const line = createTextLine(defaults, 0);
    line.duration = 2;
    line.raw = 'a||b';
    line.segments = [
      { text: 'a', isMath: false, color: '#fff', bold: false, italic: false },
      { text: 'b', isMath: false, color: '#fff', bold: false, italic: false },
    ];
    const sr = createSurroundingRect([line.id], 0);
    sr.segmentIndices = [0, 1];

    const code = exportManimCode([line, sr], {
      fullFile: false,
      defaults,
      audioItems: [],
    });

    expect(code).toContain('VGroup(');
    expect(code).toMatch(/line_1\[0\]/);
    expect(code).toMatch(/line_1\[1\]/);
    expect(code).toContain('SurroundingRectangle(');
  });

  it('surrounding rect around two shapes uses VGroup of both vars', () => {
    const defaults = defaultSceneDefaults();
    const a = createShape(0);
    a.layer = 0;
    const b = createShape(0);
    b.layer = 1;
    const sr = createSurroundingRect([a.id, b.id], 0);

    const code = exportManimCode([a, b, sr], {
      fullFile: false,
      defaults,
      audioItems: [],
    });

    expect(code).toContain('VGroup(');
    expect(code).toContain('SurroundingRectangle(');
    const m = code.match(/VGroup\(([^)]+)\)/);
    expect(m).toBeTruthy();
    const inner = m![1]!.split(',').map((s) => s.trim()).filter(Boolean);
    expect(inner.length).toBe(2);
    expect(inner.every((x) => x.startsWith('shape_'))).toBe(true);
  });

  it('merges overlapping multi-segment line with another line (no per-segment waits)', () => {
    const defaults = defaultSceneDefaults();
    const a = createTextLine(defaults, 50);
    a.duration = 3;
    a.raw = 'A||B';
    a.segments = [
      { text: 'A', isMath: false, color: '#fff', bold: false, italic: false },
      { text: 'B', isMath: false, color: '#fff', bold: false, italic: false },
    ];
    const b = createTextLine(defaults, 51);
    b.duration = 2;
    b.raw = 'C';
    b.segments = [seg('C')];

    const code = exportManimCode([a, b], {
      fullFile: false,
      defaults,
      audioItems: [],
    });

    expect(code).toContain('AnimationGroup(');
    expect(code).toContain('Succession(Wait(0.0000), Write(');
  });

  it('does not merge back-to-back lines (holdEnd === next start)', () => {
    const defaults = defaultSceneDefaults();
    const a = createTextLine(defaults, 0);
    a.duration = 2;
    a.raw = 'A';
    a.segments = [seg('A')];
    const b = createTextLine(defaults, 2);
    b.duration = 2;
    b.raw = 'B';
    b.segments = [seg('B')];

    const code = exportManimCode([a, b], {
      fullFile: false,
      defaults,
      audioItems: [],
    });

    expect(code).not.toContain('AnimationGroup(');
    const writeCount = (code.match(/self\.play\(Write\(/g) ?? []).length;
    expect(writeCount).toBe(2);
  });

  it('caps bound-audio tail after first line so the next line is not delayed by full file length', () => {
    const defaults = defaultSceneDefaults();
    const a = createTextLine(defaults, 0);
    a.duration = 3;
    a.raw = 'WorstCase';
    a.segments = [seg('WorstCase')];
    a.audioTrackId = 'shared';

    const b = createTextLine(defaults, 5.5);
    b.duration = 2;
    b.raw = 'NoSol';
    b.segments = [seg('NoSol')];
    b.audioTrackId = 'shared';

    const code = exportManimCode([a, b], {
      fullFile: false,
      defaults,
      audioItems: [
        {
          id: 'shared',
          text: 'x',
          audioUrl: '/assets/audio/x.webm',
          assetRelPath: 'assets/audio/x.webm',
          startTime: 0,
          duration: 20,
          boundaries: [
            { word: 'w', start: 0, end: 3 },
            { word: 'n', start: 5.5, end: 7.5 },
          ],
        },
      ],
    });

    expect(code).toMatch(/self\.wait\(2\.5000\)/);
    const writeBlocks = code.match(/Write\(/g) ?? [];
    expect(writeBlocks.length).toBeGreaterThanOrEqual(2);
  });

  it('emits add_sound at track start when bound audio begins before the line (no duplicate at line play)', () => {
    const defaults = defaultSceneDefaults();
    const line = createTextLine(defaults, 8);
    line.duration = 2;
    line.raw = 'ODE';
    line.segments = [seg('ODE')];
    line.audioTrackId = 'early_a';

    const code = exportManimCode([line], {
      fullFile: false,
      defaults,
      audioItems: [
        {
          id: 'early_a',
          text: 'narration',
          audioUrl: '/assets/audio/x.webm',
          assetRelPath: 'assets/audio/x.webm',
          startTime: 4.8,
          duration: 10,
          boundaries: [{ word: 'x', start: 0, end: 2 }],
        },
      ],
    });

    const sounds = code.match(/self\.add_sound/g) ?? [];
    expect(sounds.length).toBe(1);
    expect(code.indexOf('self.add_sound')).toBeLessThan(code.indexOf('Write('));
  });

  it('emits self.wait tail when bound audio file is longer than boundary run_time', () => {
    const defaults = defaultSceneDefaults();
    const line = createTextLine(defaults, 0);
    line.duration = 1.5;
    line.raw = 'Hi';
    line.segments = [
      {
        text: 'Hi',
        isMath: false,
        color: '#fff',
        bold: false,
        italic: false,
      },
    ];
    line.audioTrackId = 'a1';

    const code = exportManimCode([line], {
      fullFile: false,
      defaults,
      audioItems: [
        {
          id: 'a1',
          text: 'Hi',
          audioUrl: '/assets/audio/x.webm',
          assetRelPath: 'assets/audio/x.webm',
          startTime: 0,
          duration: 5,
          boundaries: [{ word: 'Hi', start: 0, end: 1.5 }],
        },
      ],
    });

    expect(code).toContain('self.add_sound(');
    expect(code).toMatch(/self\.wait\(3\.5000\)/);
  });

  it('exports per-segment Succession with Wait when segment has waitAfterSec', () => {
    const defaults = defaultSceneDefaults();
    const line = createTextLine(defaults, 0);
    line.duration = 2;
    line.raw = 'A||B';
    line.segments = [
      {
        text: 'A',
        isMath: false,
        color: '#fff',
        bold: false,
        italic: false,
        waitAfterSec: 0.5,
      },
      {
        text: 'B',
        isMath: false,
        color: '#fff',
        bold: false,
        italic: false,
      },
    ];

    const code = exportManimCode([line], {
      fullFile: false,
      defaults,
      audioItems: [],
    });

    expect(code).toContain('Succession(');
    expect(code).toContain('Wait(0.5000)');
    expect(code).toContain('[0]');
    expect(code).toContain('[1]');
  });

  it('segment waitAfterSec does not inflate run_time when bound audio is present', () => {
    // The segment wait must appear as Wait() inside Succession, NOT be included in
    // run_time — which would double-count it and cause the Write to run past the audio end.
    const defaults = defaultSceneDefaults();
    const line = createTextLine(defaults, 0);
    line.duration = 3;
    line.raw = 'A||B';
    line.segments = [
      {
        text: 'A',
        isMath: false,
        color: '#fff',
        bold: false,
        italic: false,
        waitAfterSec: 2,
      },
      {
        text: 'B',
        isMath: false,
        color: '#fff',
        bold: false,
        italic: false,
      },
    ];
    line.audioTrackId = 'narr';

    // Audio: 4-second file covering the 3-second animation (not the 5-second effective duration).
    const code = exportManimCode([line], {
      fullFile: false,
      defaults,
      audioItems: [
        {
          id: 'narr',
          text: 'narration',
          audioUrl: '/assets/audio/narr.webm',
          assetRelPath: 'assets/audio/narr.webm',
          startTime: 0,
          duration: 4,
          boundaries: [
            { word: 'A', start: 0, end: 1.5 },
            { word: 'B', start: 1.5, end: 3 },
          ],
        },
      ],
    });

    // run_time for each segment must be based on the 3-second narration boundary span,
    // NOT the 5-second effective duration (3 + 2 wait).  So per-segment ≈ 1.5s.
    expect(code).toMatch(/Write\([^)]+\[0\][^)]+run_time=1\.5/);
    // The Wait(2) must still appear as a separate node.
    expect(code).toContain('Wait(2.0000)');
    // The total self.play Succession runs for 3s (narration) + 2s (wait) = 5s,
    // so a 1-second tail wait follows to let the 4s file finish from scene-time 0.
    // audioEnd = 0 + 4 = 4; animEnd = 0 + 3 + 2 = 5 → tail = max(0, 4 - 5) = 0.
    // Actually 4 < 5 so tail = 0 — the audio ends before the animation; no tail wait needed.
    expect(code).not.toMatch(/self\.wait\(\d/);
  });

  it('uses per-segment animSec for unequal Write run_time in Succession', () => {
    const defaults = defaultSceneDefaults();
    const line = createTextLine(defaults, 0);
    line.duration = 3;
    line.raw = 'A||B';
    line.segments = [
      {
        text: 'A',
        isMath: false,
        color: '#fff',
        bold: false,
        italic: false,
        animSec: 2,
      },
      {
        text: 'B',
        isMath: false,
        color: '#fff',
        bold: false,
        italic: false,
        animSec: 1,
      },
    ];

    const code = exportManimCode([line], {
      fullFile: false,
      defaults,
      audioItems: [],
    });

    expect(code).toMatch(/Write\([^)]+\[0\][^)]+run_time=2\.0/);
    expect(code).toMatch(/Write\([^)]+\[1\][^)]+run_time=1\.0/);
  });
});

describe('exportManimCode visibleAtSceneStart (static self.add)', () => {
  it('prepends self.add for images and skips FadeIn when flag is set', () => {
    const defaults = defaultSceneDefaults();
    const image = createTestImage(0);
    image.visibleAtSceneStart = true;
    image.duration = 2;

    const code = exportManimCode([image], {
      fullFile: false,
      defaults,
      audioItems: [],
    });

    expect(code).toContain('self.add(image_1)');
    expect(code).not.toContain('self.play(FadeIn(image_1)');
    // Scene-start images consume zero intro seconds; final hold padding covers 0..2.
    expect(code).toContain('_wait_to(self, 2.0000)');
  });

  it('emits bound audio for a visible-at-scene-start image as timeline audio', () => {
    const defaults = defaultSceneDefaults();
    const image = createTestImage(0);
    image.visibleAtSceneStart = true;
    image.audioTrackId = 'img-audio';

    const code = exportManimCode([image], {
      fullFile: false,
      defaults,
      audioItems: [
        {
          id: 'img-audio',
          text: 'audio',
          audioUrl: '/assets/audio/img.webm',
          assetRelPath: 'assets/audio/img.webm',
          startTime: 0,
          duration: 1.2,
        },
      ],
    });

    const sounds = code.match(/self\.add_sound\("assets\/audio\/img\.webm"/g) ?? [];
    expect(sounds.length).toBe(1);
    expect(code).toContain('self.add(image_1)');
    expect(code).not.toContain('self.play(FadeIn(image_1)');
  });

  it('prepends self.add for axes and skips Create(axes) when flag is set', () => {
    const defaults = defaultSceneDefaults();
    const ax = createAxes(defaults, 0);
    ax.visibleAtSceneStart = true;
    ax.startTime = 0;

    const code = exportManimCode([ax], {
      fullFile: false,
      defaults,
      audioItems: [],
    });

    const addIdx = code.indexOf('self.add(');
    expect(addIdx).toBeGreaterThan(-1);
    // No leaf play events when the only visual is scene-start — only waits after static add.
    expect(code).toContain('_wait_to(self, ');
    expect(code).not.toContain('Create(');
  });

  it('still runs exit animation on a scene-start object', () => {
    const defaults = defaultSceneDefaults();
    const ax = createAxes(defaults, 0);
    ax.visibleAtSceneStart = true;
    ax.startTime = 0;
    const ex = createExitAnimation([ax.id], 3, 1);

    const code = exportManimCode([ax, ex], {
      fullFile: false,
      defaults,
      audioItems: [],
    });

    expect(code).toContain('self.add(');
    expect(code).toMatch(/FadeOut|Uncreate|ShrinkToCenter/);
  });
});

describe('exportManimCode absolute timeline waits', () => {
  function scene() {
    const defaults = defaultSceneDefaults();
    const a = createTextLine(defaults, 0); a.raw = 'a'; a.segments = [seg('a')]; a.duration = 1;
    const b = createTextLine(defaults, 2.5); b.raw = 'b'; b.segments = [seg('b')]; b.duration = 0.5;
    // Keep the sting unbound so the scene end is reached by the exporter's final wait, not a leaf tail.
    b.audioTrackId = AUDIO_BINDING_NONE;
    const sting = {
      id: 'sting', text: 'sting', audioUrl: '/assets/audio/sting.webm',
      assetRelPath: 'assets/audio/sting.webm', startTime: 1.5, duration: 2,
    };
    return { defaults, items: [a, b], audioItems: [sting] };
  }

  it('waits until absolute timeline times so Manim frame rounding cannot accumulate', () => {
    const { defaults, items, audioItems } = scene();
    const code = exportManimCode(items, { fullFile: true, defaults, audioItems });
    // Hand timeline: line a 0..1, unbound sting at 1.5 (ends 3.5), line b 2.5..3.0, scene end 3.5.
    expect(code.match(/_wait_to\(self, [\d.]+\)/g)).toEqual([
      '_wait_to(self, 1.5000)', '_wait_to(self, 2.5000)', '_wait_to(self, 3.5000)',
    ]);
    expect(code).not.toMatch(/^\s+self\.wait\(/m);
    expect(code.indexOf('_wait_to(self, 1.5000)')).toBeLessThan(code.indexOf('self.add_sound('));
    expect(code.indexOf('_wait_to(self, 2.5000)')).toBeLessThan(code.lastIndexOf('Write('));
  });

  it('emits the helper once at module scope before the scene class, and in partial export', () => {
    const { defaults, items, audioItems } = scene();
    const full = exportManimCode(items, { fullFile: true, defaults, audioItems });
    expect(full.match(/^def _wait_to\(scene, t\):$/gm)).toHaveLength(1);
    expect(full).toContain('    frames = round((t - scene.time) * config.frame_rate)\n');
    expect(full).toContain('        scene.wait((frames + 0.5) / config.frame_rate)\n');
    expect(full.indexOf('def _wait_to(')).toBeLessThan(full.indexOf('\nclass '));

    const partial = exportManimCode(items, { fullFile: false, defaults, audioItems });
    expect(partial).toContain('def _wait_to(scene, t):');
    expect(partial).toContain('_wait_to(self, 1.5000)');
  });

  it('omits the helper when no cursor wait is needed', () => {
    const defaults = defaultSceneDefaults();
    const a = createTextLine(defaults, 0); a.raw = 'a'; a.segments = [seg('a')]; a.duration = 1;
    const code = exportManimCode([a], { fullFile: true, defaults });
    expect(code).not.toContain('_wait_to');
  });
});
