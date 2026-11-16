import { describe, expect, it } from 'vitest';
import type { BlinkAnimationItem, SceneItem } from '@/types/scene';
import { createImageItem, createTextLine, defaultSceneDefaults } from '@/store/factories';
import { buildBlinkConcurrentSuccessionInner, formatBlinkClipPlay } from './blinkCodegen';
import { exportManimCode } from './manimExporter';

function mapOf(...items: SceneItem[]): Map<string, SceneItem> {
  return new Map(items.map((it) => [it.id, it]));
}

describe('formatBlinkClipPlay', () => {
  it('emits scale up/down plays for a text line', () => {
    const line = createTextLine(defaultSceneDefaults(), 0);
    line.id = 'ln1';
    line.raw = 'hi';
    line.segments = [
      { text: 'hi', isMath: false, color: '#ffffff', bold: false, italic: false },
    ];
    const blink: BlinkAnimationItem = {
      kind: 'blink_animation',
      id: 'b1',
      label: '',
      layer: 0,
      startTime: 0,
      duration: 0.4,
      repetitions: 1,
      targets: [{ targetId: 'ln1', mode: 'scale', scaleFactor: 1.2 }],
    };
    const items = mapOf(line, blink);
    const idToVar = new Map<string, string>([['ln1', 'line_a']]);
    const code = formatBlinkClipPlay(blink, '  ', idToVar, items);
    expect(code).toContain('self.play(');
    expect(code).toContain('line_a.animate.scale(');
    expect(code).toMatch(/run_time=0\.2000/);
  });

  it('uses VGroup for text segment subset', () => {
    const line = createTextLine(defaultSceneDefaults(), 0);
    line.id = 'ln1';
    line.segments = [
      { text: 'a', isMath: false, color: '#ff0000', bold: false, italic: false },
      { text: 'b', isMath: false, color: '#00ff00', bold: false, italic: false },
    ];
    const blink: BlinkAnimationItem = {
      kind: 'blink_animation',
      id: 'b1',
      label: '',
      layer: 0,
      startTime: 0,
      duration: 0.2,
      repetitions: 1,
      targets: [
        { targetId: 'ln1', mode: 'scale', scaleFactor: 1.1, segmentIndices: [0] },
      ],
    };
    const items = mapOf(line, blink);
    const idToVar = new Map<string, string>([['ln1', 'line_a']]);
    const code = formatBlinkClipPlay(blink, '', idToVar, items);
    expect(code).toContain('line_a[0].animate.scale(');
  });

  it('emits line_a[0][2] for a single math child blink target', () => {
    const line = createTextLine(defaultSceneDefaults(), 0);
    line.id = 'ln1';
    line.segments = [
      { text: '$x$', isMath: true, color: '#ffffff', bold: false, italic: false },
    ];
    const blink: BlinkAnimationItem = {
      kind: 'blink_animation',
      id: 'b1',
      label: '',
      layer: 0,
      startTime: 0,
      duration: 0.2,
      repetitions: 1,
      targets: [
        {
          targetId: 'ln1',
          mode: 'scale',
          scaleFactor: 1.1,
          mathSubtargets: [{ segmentIndex: 0, childIndices: [2] }],
        },
      ],
    };
    const items = mapOf(line, blink);
    const idToVar = new Map<string, string>([['ln1', 'line_a']]);
    const code = formatBlinkClipPlay(blink, '', idToVar, items);
    expect(code).toContain('line_a[0][2].animate.scale(');
  });

  it('uses VGroup for multiple math children in one segment', () => {
    const line = createTextLine(defaultSceneDefaults(), 0);
    line.id = 'ln1';
    line.segments = [
      { text: '$a+b$', isMath: true, color: '#ffffff', bold: false, italic: false },
    ];
    const blink: BlinkAnimationItem = {
      kind: 'blink_animation',
      id: 'b1',
      label: '',
      layer: 0,
      startTime: 0,
      duration: 0.2,
      repetitions: 1,
      targets: [
        {
          targetId: 'ln1',
          mode: 'scale',
          scaleFactor: 1.12,
          mathSubtargets: [{ segmentIndex: 0, childIndices: [1, 3] }],
        },
      ],
    };
    const items = mapOf(line, blink);
    const idToVar = new Map<string, string>([['ln1', 'line_a']]);
    const code = formatBlinkClipPlay(blink, '', idToVar, items);
    expect(code).toContain('VGroup(line_a[0][1], line_a[0][3])');
  });

  it('includes color animate for color-only mode', () => {
    const line = createTextLine(defaultSceneDefaults(), 0);
    line.id = 'ln1';
    line.segments = [];
    const blink: BlinkAnimationItem = {
      kind: 'blink_animation',
      id: 'b1',
      label: '',
      layer: 0,
      startTime: 0,
      duration: 0.2,
      repetitions: 1,
      targets: [{ targetId: 'ln1', mode: 'color', blinkColor: '#00ffff' }],
    };
    const items = mapOf(line, blink);
    const idToVar = new Map<string, string>([['ln1', 'line_a']]);
    const code = formatBlinkClipPlay(blink, '', idToVar, items);
    expect(code).toContain('.animate.set_color(');
  });

  it('supports image scale blink', () => {
    const img = createImageItem({
      srcUrl: 'blob:img',
      fileName: 'img.png',
      mimeType: 'image/png',
      width: 2,
      height: 1,
    });
    img.id = 'img1';
    const blink: BlinkAnimationItem = {
      kind: 'blink_animation',
      id: 'b_img',
      label: '',
      layer: 0,
      startTime: 0,
      duration: 0.6,
      repetitions: 1,
      targets: [{ targetId: 'img1', mode: 'scale', scaleFactor: 1.25 }],
    };
    const code = formatBlinkClipPlay(
      blink,
      '',
      new Map([['img1', 'image_a']]),
      mapOf(img, blink),
    );

    expect(code).toContain('image_a.animate.scale(1.250000)');
    expect(code).toContain('image_a.animate.scale(0.800000)');
    expect(code).toMatch(/run_time=0\.3000/);
  });

  it('does not emit color blink for images', () => {
    const img = createImageItem({
      srcUrl: 'blob:img',
      fileName: 'img.png',
      mimeType: 'image/png',
      width: 2,
      height: 1,
    });
    img.id = 'img1';
    const blink: BlinkAnimationItem = {
      kind: 'blink_animation',
      id: 'b_img_color',
      label: '',
      layer: 0,
      startTime: 0,
      duration: 0.6,
      repetitions: 1,
      targets: [{ targetId: 'img1', mode: 'color', blinkColor: '#ff0000' }],
    };
    const code = formatBlinkClipPlay(
      blink,
      '',
      new Map([['img1', 'image_a']]),
      mapOf(img, blink),
    );

    expect(code).toBe('');
  });
});

describe('blink in a concurrent cluster', () => {
  // Manim's `.animate` stores its end state on the mobject when the expression is evaluated, so
  // colour-on / colour-off steps built together in one Succession all end at the last colour and
  // the blink is invisible in the render (it showed in the preview). Those steps must be lazy.
  const seg = (text: string) => ({ text, isMath: true, color: '#00ffff', bold: false, italic: false });

  function blinkOn(startTime: number): BlinkAnimationItem {
    return {
      kind: 'blink_animation',
      id: 'b1',
      label: '',
      layer: 0,
      startTime,
      duration: 1.5,
      repetitions: 2,
      targets: [{ targetId: 'ln1', mode: 'color', blinkColor: '#FFFF00', segmentIndices: [1] }],
    };
  }

  it('builds every step with ApplyFunction so each reads the mobject when it starts', () => {
    const line = createTextLine(defaultSceneDefaults(), 0);
    line.id = 'ln1';
    line.segments = [seg('a'), seg('b')];
    const blink = blinkOn(0);
    const inner = buildBlinkConcurrentSuccessionInner(blink, new Map([['ln1', 'line_a']]), mapOf(line, blink))!;
    expect(inner).not.toContain('.animate');
    expect(inner.match(/ApplyFunction\(lambda m: m\.set_color\(ManimColor\("#FFFF00"\)\), line_a\[1\]\)/g)).toHaveLength(2);
    expect(inner.match(/ApplyFunction\(lambda m: m\.set_color\(ManimColor\("#00ffff"\)\), line_a\[1\]\)/g)).toHaveLength(2);
  });

  it('exports a blink that overlaps the next line being written without .animate chains', () => {
    const defaults = defaultSceneDefaults();
    const first = createTextLine(defaults, 0);
    Object.assign(first, { id: 'ln1', raw: '$a$$b$', startTime: 0, duration: 1, segments: [seg('a'), seg('b')] });
    const second = createTextLine(defaults, 0);
    Object.assign(second, { id: 'ln2', raw: '$c$', startTime: 1, duration: 1.5, segments: [seg('c')] });
    const code = exportManimCode([first, second, blinkOn(1)], { fullFile: false, defaults });
    expect(code).not.toMatch(/EXPORT ERROR/);
    expect(code).toMatch(/AnimationGroup\([\s\S]*ApplyFunction\(lambda m: m\.set_color\(ManimColor\("#FFFF00"\)\)[\s\S]*Write\(/);
    expect(code).not.toMatch(/\]\.animate\.set_color/);
  });

  it('keeps .animate in the one-play-per-step path, where it is built just before playing', () => {
    const line = createTextLine(defaultSceneDefaults(), 0);
    line.id = 'ln1';
    line.segments = [seg('a'), seg('b')];
    const blink = blinkOn(0);
    const code = formatBlinkClipPlay(blink, '', new Map([['ln1', 'line_a']]), mapOf(line, blink));
    expect(code).toContain('line_a[1].animate.set_color(ManimColor("#FFFF00"))');
    expect(code).not.toContain('ApplyFunction');
  });
});
