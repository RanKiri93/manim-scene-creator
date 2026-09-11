import { describe, expect, it } from 'vitest';
import type { ExitAnimationItem, ImageItem, SceneItem, TextLineItem, BlinkAnimationItem } from '@/types/scene';
import {
  canBeBlinkTarget,
  canBeExitTarget,
  canBeSurroundTarget,
  effectiveEnd,
  holdEnd,
  isActiveAtTime,
  runDuration,
  timelineSpanEnd,
  canBeTargetAnimationTargetKind,
} from './time';

function mapOf(...items: SceneItem[]): Map<string, SceneItem> {
  return new Map(items.map((it) => [it.id, it]));
}

function minimalLine(id: string, startTime: number, duration: number): TextLineItem {
  return {
    kind: 'textLine',
    id,
    label: '',
    layer: 0,
    startTime,
    duration,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    audioTrackId: null,
    raw: '',
    font: 'Alef',
    fontSize: 36,
    segments: [],
    measure: null,
    measureError: null,
    previewDataUrl: null,
    segmentMeasures: null,
    mathChildMeasures: null,
  };
}

function minimalExit(
  id: string,
  targetId: string,
  startTime: number,
  duration: number,
): ExitAnimationItem {
  return {
    kind: 'exit_animation',
    id,
    label: '',
    layer: 0,
    startTime,
    duration,
    targets: [{ targetId, animStyle: 'fade_out' }],
  };
}

function minimalImage(id: string, startTime: number, duration: number): ImageItem {
  return {
    kind: 'image',
    id,
    label: '',
    layer: 0,
    startTime,
    duration,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    audioTrackId: null,
    srcUrl: 'blob:test',
    fileName: 'pic.png',
    mimeType: 'image/png',
    width: 3,
    height: 2,
    opacity: 1,
    rotationDeg: 0,
  };
}

function minimalBlink(
  id: string,
  targetId: string,
  startTime: number,
  duration: number,
): BlinkAnimationItem {
  return {
    kind: 'blink_animation',
    id,
    label: '',
    layer: 0,
    startTime,
    duration,
    repetitions: 1,
    targets: [
      { targetId, mode: 'scale', scaleFactor: 1.2, blinkColor: '#fbbf24' },
    ],
  };
}

describe('runDuration', () => {
  it('returns exit_animation clip duration for timeline bar width', () => {
    const ex = minimalExit('ex', 'l1', 5, 2);
    const items = mapOf(ex);
    expect(runDuration(ex, items)).toBe(2);
  });

  it('clamps exit_animation duration to at least 0.05', () => {
    const ex = minimalExit('ex', 'l1', 0, 0.02);
    const items = mapOf(ex);
    expect(runDuration(ex, items)).toBe(0.05);
  });

  it('returns blink_animation clip duration for timeline bar width', () => {
    const bl = minimalBlink('b1', 'l1', 0, 0.4);
    const items = mapOf(bl);
    expect(runDuration(bl, items)).toBe(0.4);
  });

  it('clamps blink_animation duration to at least 0.05', () => {
    const bl = minimalBlink('b1', 'l1', 0, 0.02);
    const items = mapOf(bl);
    expect(runDuration(bl, items)).toBe(0.05);
  });
});

describe('timelineSpanEnd', () => {
  it('uses startTime + duration for exit_animation clips', () => {
    const ex = minimalExit('ex', 'l1', 3, 1.5);
    const items = mapOf(ex);
    expect(timelineSpanEnd(ex, items)).toBeCloseTo(4.5);
  });

  it('uses startTime + duration for blink_animation clips', () => {
    const bl = minimalBlink('b1', 'l1', 2, 0.8);
    const items = mapOf(bl);
    expect(timelineSpanEnd(bl, items)).toBeCloseTo(2.8);
  });

  it('extends target span through exit clip end', () => {
    const line = minimalLine('l1', 0, 2);
    const exit = minimalExit('ex', 'l1', 2, 2);
    const items = mapOf(line, exit);
    expect(holdEnd(line, items)).toBe(2);
    expect(timelineSpanEnd(line, items)).toBe(4);
    expect(effectiveEnd(line, items)).toBe(4);
  });

  it('isActiveAtTime is false for blink_animation', () => {
    const bl = minimalBlink('b1', 'l1', 1, 1);
    const items = mapOf(bl, minimalLine('l1', 0, 2));
    expect(isActiveAtTime(bl, 1.5, items)).toBe(false);
  });

  it('effectiveEnd is 0 for blink_animation (effect clip)', () => {
    const bl = minimalBlink('b1', 'l1', 0, 1);
    const items = mapOf(bl);
    expect(effectiveEnd(bl, items)).toBe(0);
  });
});

describe('canBeTargetAnimationTargetKind', () => {
  it('restricts move/path to independent-position objects', () => {
    expect(canBeTargetAnimationTargetKind('move', 'graphDot')).toBe(false);
    expect(canBeTargetAnimationTargetKind('move', 'axes')).toBe(true);
  });

  it('allows scale on graph overlays like blink targets', () => {
    expect(canBeTargetAnimationTargetKind('scale', 'graphPlot')).toBe(true);
  });
});

describe('image items', () => {
  it('uses duration for run/hold/span and stays active like other drawables', () => {
    const img = minimalImage('img1', 2, 3);
    const items = mapOf(img);
    expect(runDuration(img, items)).toBe(3);
    expect(holdEnd(img, items)).toBe(5);
    expect(timelineSpanEnd(img, items)).toBe(5);
    expect(isActiveAtTime(img, 1.99, items)).toBe(false);
    expect(isActiveAtTime(img, 2, items)).toBe(true);
    expect(effectiveEnd(img, items)).toBe(Number.POSITIVE_INFINITY);
  });

  it('extends through an exit clip end', () => {
    const img = minimalImage('img1', 0, 2);
    const exit = minimalExit('ex', 'img1', 2, 2);
    const items = mapOf(img, exit);
    expect(timelineSpanEnd(img, items)).toBe(4);
    expect(effectiveEnd(img, items)).toBe(4);
  });

  it('can be an exit/surround/blink target', () => {
    const img = minimalImage('img1', 0, 2);
    expect(canBeSurroundTarget(img)).toBe(true);
    expect(canBeExitTarget(img)).toBe(true);
    expect(canBeBlinkTarget(img)).toBe(true);
  });

  it('allows scale/move/path/rotate target animations but not color', () => {
    expect(canBeTargetAnimationTargetKind('scale', 'image')).toBe(true);
    expect(canBeTargetAnimationTargetKind('move', 'image')).toBe(true);
    expect(canBeTargetAnimationTargetKind('path', 'image')).toBe(true);
    expect(canBeTargetAnimationTargetKind('rotate', 'image')).toBe(true);
    expect(canBeTargetAnimationTargetKind('color', 'image')).toBe(false);
  });
});
