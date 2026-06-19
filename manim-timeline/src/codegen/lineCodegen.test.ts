import { describe, expect, it } from 'vitest';
import { generateLinePlay, generateLinePos, pickAudioTrackForClip } from './lineCodegen';
import { AUDIO_BINDING_NONE } from '@/lib/audioBinding';
import type { AudioTrackItem, MeasureResult, TextLineItem } from '@/types/scene';

const measure: MeasureResult = {
  width: 4,
  height: 1,
  widthInk: 2,
  heightInk: 0.5,
  offsetInkX: 0.5,
  offsetInkY: 0.1,
  inkLeftX: -0.5,
  inkRightX: 1.5,
  inkTopY: 0.35,
  inkBottomY: -0.15,
  bboxLeft: -2,
  bboxRight: 2,
  bboxTop: 0.5,
  bboxBottom: -0.5,
  pngBase64: null,
  pngWidth: null,
  pngHeight: null,
  segmentMeasures: null,
  mathChildMeasures: null,
};

function textLine(posSteps: TextLineItem['posSteps']): TextLineItem {
  return {
    kind: 'textLine',
    id: 'line',
    label: 'line',
    layer: 0,
    startTime: 0,
    duration: 1,
    x: 0,
    y: 0,
    scale: 1,
    posSteps,
    audioTrackId: null,
    raw: 'שלום',
    font: 'Alef',
    fontSize: 36,
    segments: [{ text: 'שלום', isMath: false, color: '#ffffff', bold: false, italic: false }],
    measure,
    measureError: null,
    previewDataUrl: null,
    segmentMeasures: null,
    mathChildMeasures: null,
  };
}

describe('generateLinePos to_edge bounds', () => {
  it('applies line scale before absolute positioning', () => {
    const item = textLine([{ kind: 'absolute' }]);
    item.scale = 1.5;

    const code = generateLinePos(item, 'line_1', 8, new Map(), new Map());

    expect(code.indexOf('line_1.scale(1.500000)')).toBeLessThan(
      code.indexOf('line_1.move_to([0.000000, 0.000000, 0])'),
    );
  });

  it('emits a resolved move_to for ink-aware to_edge', () => {
    const code = generateLinePos(
      textLine([{ kind: 'to_edge', edge: 'RIGHT', buff: 0.3, bounds: 'ink' }]),
      'line_1',
      8,
      new Map(),
      new Map(),
    );

    expect(code).toContain('line_1.move_to([5.311111, 0.000000, 0])');
    expect(code).not.toContain('line_1.to_edge(');
  });

  it('resolves scaled ink-aware to_edge directly', () => {
    const item = textLine([{ kind: 'to_edge', edge: 'RIGHT', buff: 0.3, bounds: 'ink' }]);
    item.scale = 2;

    const code = generateLinePos(item, 'line_1', 8, new Map(), new Map());

    expect(code).toContain('line_1.scale(2.000000)');
    expect(code).toContain('line_1.move_to([3.811111, 0.000000, 0])');
  });

  it('resolves mobject-bounds to_edge directly', () => {
    const code = generateLinePos(
      textLine([{ kind: 'to_edge', edge: 'RIGHT', buff: 0.3, bounds: 'mobject' }]),
      'line_1',
      8,
      new Map(),
      new Map(),
    );

    expect(code).toContain('line_1.move_to([4.811111, 0.000000, 0])');
    expect(code).not.toContain('line_1.to_edge(');
    expect(code).not.toContain('line_1.shift(');
  });
});

describe('generateLinePlay transform modes', () => {
  it('exports whole-line transforms as one ReplacementTransform', () => {
    const source = textLine([{ kind: 'absolute' }]);
    source.id = 'source';
    const target = textLine([{ kind: 'absolute' }]);
    target.id = 'target';
    target.animStyle = 'transform';
    target.duration = 2;
    target.transformConfig = {
      sourceLineId: source.id,
      mode: 'whole',
      segmentPairs: { 0: 0 },
      unmappedSourceBehavior: 'fade_out',
      unmappedTargetBehavior: 'fade_in',
    };

    const code = generateLinePlay(
      target,
      'line_2',
      8,
      new Map([
        [source.id, 'line_1'],
        [target.id, 'line_2'],
      ]),
      new Map([
        [source.id, source],
        [target.id, target],
      ]),
    );

    expect(code).toContain('self.play(ReplacementTransform(line_1, line_2), run_time=2)');
    expect(code).not.toContain('line_1[0]');
    expect(code).not.toContain('FadeIn(line_2[0])');
  });

  it('keeps legacy segment transforms by default', () => {
    const source = textLine([{ kind: 'absolute' }]);
    source.id = 'source';
    const target = textLine([{ kind: 'absolute' }]);
    target.id = 'target';
    target.animStyle = 'transform';
    target.transformConfig = {
      sourceLineId: source.id,
      segmentPairs: { 0: 0 },
      unmappedSourceBehavior: 'fade_out',
      unmappedTargetBehavior: 'fade_in',
    };

    const code = generateLinePlay(
      target,
      'line_2',
      8,
      new Map([
        [source.id, 'line_1'],
        [target.id, 'line_2'],
      ]),
      new Map([
        [source.id, source],
        [target.id, target],
      ]),
    );

    expect(code).toContain('ReplacementTransform(line_1[0], line_2[0])');
  });
});

function audioTrack(id: string, startTime: number, duration: number): AudioTrackItem {
  return {
    id,
    text: '',
    audioUrl: '',
    startTime,
    duration,
  };
}

describe('pickAudioTrackForClip', () => {
  it('explicit none skips overlap heuristic', () => {
    const t = audioTrack('a', 0, 2);
    expect(
      pickAudioTrackForClip(AUDIO_BINDING_NONE, 0, 2, [t]),
    ).toBeUndefined();
  });

  it('explicit id wins regardless of overlap', () => {
    const t1 = audioTrack('x', 10, 1);
    const t2 = audioTrack('y', 0, 10);
    expect(pickAudioTrackForClip('y', 0, 2, [t1, t2])?.id).toBe('y');
  });

  it('null uses overlap heuristic', () => {
    const overlapping = audioTrack('ov', 0, 10);
    const far = audioTrack('far', 100, 1);
    expect(pickAudioTrackForClip(null, 1, 2, [overlapping, far])?.id).toBe(
      'ov',
    );
  });

  it('explicit id missing from list yields undefined', () => {
    expect(
      pickAudioTrackForClip('missing', 0, 5, [audioTrack('other', 0, 10)]),
    ).toBeUndefined();
  });
});

