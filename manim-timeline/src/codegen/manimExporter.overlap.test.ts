import { describe, expect, it } from 'vitest';
import { exportManimCode } from './manimExporter';
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
      'self.play(self.camera.frame.animate.move_to(14.222222 * RIGHT), run_time=1.500000)',
    );
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
    // Timeline by hand: image consumes 0..1.5, line starts at 3.0, so wait = 1.5.
    expect(code).toContain('self.wait(1.5000)');
    expect(code.indexOf('self.wait(1.5000)')).toBeLessThan(code.indexOf('Write('));
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
    expect(code).toContain('self.wait(2.0000)');
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
    expect(code).toContain('self.wait(');
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
