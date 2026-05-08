import { describe, expect, it } from 'vitest';
import type { BlinkAnimationItem } from '@/types/scene';
import { createTextLine, defaultSceneDefaults } from '@/store/factories';
import { formatBlinkClipPlay } from './blinkCodegen';

function mapOf<T extends { id: string }>(...items: T[]): Map<string, T> {
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
    expect(code).toContain('VGroup(line_a[0])');
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
});
