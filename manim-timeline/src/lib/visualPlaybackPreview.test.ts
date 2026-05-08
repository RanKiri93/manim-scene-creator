import { describe, expect, it } from 'vitest';
import type { AudioTrackItem, ItemId, SceneItem, TextLineItem } from '@/types/scene';
import { createExitAnimation, createTextLine, defaultSceneDefaults } from '@/store/factories';
import {
  activeTextTransformForLine,
  blinkPreviewForTarget,
  exitPreviewForTarget,
  previewRunTime,
  textIntroSegmentStates,
} from './visualPlaybackPreview';
import { createBlinkAnimation } from '@/store/factories';

function mapOf(...items: SceneItem[]): Map<ItemId, SceneItem> {
  return new Map(items.map((it) => [it.id, it]));
}

function line(id: string, startTime = 0): TextLineItem {
  const item = createTextLine(defaultSceneDefaults(), startTime);
  item.id = id;
  item.raw = 'a b';
  item.duration = 2;
  item.segments = [
    { text: 'a', isMath: false, color: '#ffffff', bold: false, italic: false },
    {
      text: 'b',
      isMath: false,
      color: '#ffffff',
      bold: false,
      italic: false,
      waitAfterSec: 0.5,
    },
  ];
  return item;
}

describe('textIntroSegmentStates', () => {
  it('reveals text segments sequentially with waits preserved', () => {
    const item = line('line1', 1);
    const items = mapOf(item);

    expect(textIntroSegmentStates(item, 0.9, items)[0]!.progress).toBe(0);

    const duringFirst = textIntroSegmentStates(item, 1.5, items);
    expect(duringFirst[0]!.progress).toBeCloseTo(0.5);
    expect(duringFirst[1]!.progress).toBe(0);

    const duringSecond = textIntroSegmentStates(item, 2.5, items);
    expect(duringSecond[0]!.progress).toBe(1);
    expect(duringSecond[1]!.progress).toBeCloseTo(0.5);
  });

  it('uses recorded audio runtime for animation progress when bound', () => {
    const item = line('line1', 0);
    item.audioTrackId = 'audio1';
    const audio: AudioTrackItem = {
      id: 'audio1',
      text: 'a b',
      audioUrl: '/audio.wav',
      startTime: 0,
      duration: 4,
      boundaries: [
        { word: 'a', start: 0, end: 0.5 },
        { word: 'b', start: 0.5, end: 2.1 },
      ],
    };
    const items = mapOf(item);

    expect(previewRunTime(item, items, [audio])).toBeCloseTo(2.1);
    const states = textIntroSegmentStates(item, 0.525, items, [audio]);
    expect(states[0]!.progress).toBeCloseTo(0.5);
    expect(states[1]!.progress).toBe(0);
  });
});

describe('activeTextTransformForLine', () => {
  it('returns the active transform for both source and target lines', () => {
    const src = line('src', 0);
    const target = line('target', 3);
    target.animStyle = 'transform';
    target.transformConfig = {
      sourceLineId: src.id,
      segmentPairs: { 0: 0 },
      unmappedSourceBehavior: 'fade_out',
      unmappedTargetBehavior: 'write',
    };
    const items = mapOf(src, target);

    const sourceState = activeTextTransformForLine(src, 4, items);
    const targetState = activeTextTransformForLine(target, 4, items);
    expect(sourceState?.progress).toBeCloseTo(0.5);
    expect(targetState?.source.id).toBe(src.id);
    expect(activeTextTransformForLine(src, 5.1, items)).toBeNull();
  });
});

describe('exitPreviewForTarget', () => {
  it('computes fade and shrink exit state while the exit clip is active', () => {
    const item = line('line1', 0);
    const exit = createExitAnimation([item.id], 3, 2);
    exit.targets[0]!.animStyle = 'shrink_to_center';
    const items = mapOf(item, exit);

    const state = exitPreviewForTarget(item.id, 4, items);
    expect(state?.style).toBe('shrink_to_center');
    expect(state?.progress).toBeCloseTo(0.5);
    expect(state?.scale).toBeCloseTo(0.5);
    expect(state?.opacity).toBe(1);
    expect(exitPreviewForTarget(item.id, 5, items)).toBeNull();
  });
});

describe('blinkPreviewForTarget', () => {
  it('returns null outside the blink window', () => {
    const item = line('line1', 0);
    const blink = createBlinkAnimation([item.id], 2, 1);
    const items = mapOf(item, blink);
    expect(blinkPreviewForTarget(item.id, 1.5, items)).toBeNull();
    expect(blinkPreviewForTarget(item.id, 3.1, items)).toBeNull();
  });

  it('ramps scale envelope up then down mid-clip', () => {
    const item = line('line1', 0);
    const blink = createBlinkAnimation([item.id], 0, 2);
    blink.targets[0]!.mode = 'scale';
    blink.targets[0]!.scaleFactor = 1.1;
    const items = mapOf(item, blink);

    const s0 = blinkPreviewForTarget(item.id, 0, items);
    expect(s0?.scaleMultiplier).toBeCloseTo(1);

    const mid = blinkPreviewForTarget(item.id, 1, items);
    expect(mid?.envelope).toBeCloseTo(1);
    expect(mid?.scaleMultiplier).toBeCloseTo(1.1);

    const late = blinkPreviewForTarget(item.id, 1.99, items);
    expect(late!.envelope).toBeLessThan(0.1);
  });

  it('repeats envelope when repetitions > 1', () => {
    const item = line('line1', 0);
    const blink = createBlinkAnimation([item.id], 0, 2);
    blink.repetitions = 2;
    const items = mapOf(item, blink);

    const a = blinkPreviewForTarget(item.id, 0.25, items)?.envelope ?? -1;
    const b = blinkPreviewForTarget(item.id, 1.25, items)?.envelope ?? -1;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
  });

  it('restricts text segment indices when set on target row', () => {
    const item = line('line1', 0);
    const blink = createBlinkAnimation([item.id], 0, 1);
    blink.targets[0]!.segmentIndices = [0];
    const items = mapOf(item, blink);

    const st = blinkPreviewForTarget(item.id, 0.5, items);
    expect(st?.textSegmentIndices).toEqual(new Set([0]));
  });
});
