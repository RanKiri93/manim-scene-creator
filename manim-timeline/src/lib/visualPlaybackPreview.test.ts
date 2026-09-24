import { describe, expect, it } from 'vitest';
import type { AudioTrackItem, ImageItem, ItemId, SceneItem, TextLineItem } from '@/types/scene';
import { createBlinkAnimation, createCameraMove, createExitAnimation, createFrame, createImageItem, createTextLine, createTargetAnimation, defaultSceneDefaults } from '@/store/factories';
import {
  activeTextTransformForLine,
  blinkPreviewForTarget,
  cameraOffsetAtTime,
  cameraPosePreviewAtTime,
  exitPreviewForTarget,
  imageIntroOpacity,
  manimSmoothProgress,
  previewRunTime,
  targetAnimPreviewAccum,
  textIntroSegmentStates,
} from './visualPlaybackPreview';
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

  it('exposes eased visual progress while raw timing progress stays linear', () => {
    const item = line('line1', 1);
    const items = mapOf(item);

    // First segment animates over [1, 2): raw progress is linear in time.
    const quarter = textIntroSegmentStates(item, 1.25, items);
    expect(quarter[0]!.progress).toBeCloseTo(0.25);
    expect(quarter[0]!.visualProgress).toBeCloseTo(0.15625);
    expect(quarter[0]!.visualProgress).toBeLessThan(quarter[0]!.progress);
    expect(quarter[1]!.progress).toBe(0);

    // Fixed points of the easing are exact.
    const half = textIntroSegmentStates(item, 1.5, items);
    expect(half[0]!.progress).toBeCloseTo(0.5);
    expect(half[0]!.visualProgress).toBeCloseTo(0.5);
  });

  it('holds the next segment through the full anim plus wait window', () => {
    const item = line('line1', 0);
    item.segments = [
      { text: 'a', isMath: false, color: '#ffffff', bold: false, italic: false, waitAfterSec: 0.5 },
      { text: 'b', isMath: false, color: '#ffffff', bold: false, italic: false },
    ];
    const items = mapOf(item);

    // Segment 0 animates over [0, 1), then its 0.5 s wait: segment 1 is
    // still hidden at t = 1.25 even though segment 0 is fully revealed.
    const duringWait = textIntroSegmentStates(item, 1.25, items);
    expect(duringWait[0]!.progress).toBe(1);
    expect(duringWait[0]!.visualProgress).toBe(1);
    expect(duringWait[1]!.progress).toBe(0);
    expect(duringWait[1]!.visible).toBe(false);

    // Segment 1 starts at t = 1.5 with eased visual progress.
    const duringSecond = textIntroSegmentStates(item, 1.75, items);
    expect(duringSecond[1]!.progress).toBeCloseTo(0.25);
    expect(duringSecond[1]!.visualProgress).toBeCloseTo(0.15625);
  });
});

describe('imageIntroOpacity', () => {
  function image(id: string, startTime = 0, duration = 2): ImageItem {
    const item = createImageItem({
      srcUrl: 'blob:test',
      fileName: 'test.png',
      mimeType: 'image/png',
      width: 3,
      height: 2,
      startTime,
    });
    item.id = id;
    item.duration = duration;
    return item;
  }

  it('returns 0 before the image start time', () => {
    const item = image('img1', 1);
    const items = mapOf(item);
    expect(imageIntroOpacity(item, 0.9, items)).toBe(0);
    expect(imageIntroOpacity(item, 0, items)).toBe(0);
  });

  it('follows Manim-smooth easing over the image duration', () => {
    const item = image('img1', 1, 2);
    const items = mapOf(item);

    // Quarter through the 2 s FadeIn: eased, not linear.
    expect(imageIntroOpacity(item, 1.5, items)).toBeCloseTo(0.15625);
    expect(imageIntroOpacity(item, 1.5, items)).toBeLessThan(0.25);

    // Fixed easing point halfway through.
    expect(imageIntroOpacity(item, 2, items)).toBeCloseTo(0.5);
  });

  it('returns 1 once the intro window ends', () => {
    const item = image('img1', 1, 2);
    const items = mapOf(item);
    expect(imageIntroOpacity(item, 3, items)).toBe(1);
    expect(imageIntroOpacity(item, 5, items)).toBe(1);
  });

  it('returns 1 immediately for visibleAtSceneStart images', () => {
    const item = image('img1', 1, 2);
    item.visibleAtSceneStart = true;
    const items = mapOf(item);
    expect(imageIntroOpacity(item, 1, items)).toBe(1);
    expect(imageIntroOpacity(item, 2, items)).toBe(1);
    expect(imageIntroOpacity(item, 5, items)).toBe(1);
  });

  it('uses the image duration as the preview run time', () => {
    const item = image('img1', 1, 2);
    const items = mapOf(item);
    expect(previewRunTime(item, items)).toBeCloseTo(2);
  });
});

describe('manimSmoothProgress', () => {
  it('fixes 0, 0.5, and 1 like Manim smooth easing', () => {
    expect(manimSmoothProgress(0)).toBe(0);
    expect(manimSmoothProgress(0.5)).toBeCloseTo(0.5);
    expect(manimSmoothProgress(1)).toBe(1);
  });

  it('eases in-out: slower than linear early, faster than linear late', () => {
    expect(manimSmoothProgress(0.25)).toBeCloseTo(0.15625);
    expect(manimSmoothProgress(0.25)).toBeLessThan(0.25);
    expect(manimSmoothProgress(0.75)).toBeCloseTo(0.84375);
    expect(manimSmoothProgress(0.75)).toBeGreaterThan(0.75);
  });

  it('is monotonic and clamps out-of-range input', () => {
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const v = manimSmoothProgress(i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(manimSmoothProgress(-0.5)).toBe(0);
    expect(manimSmoothProgress(1.5)).toBe(1);
  });
});

describe('cameraOffsetAtTime', () => {
  it('interpolates from the start frame to a camera move target', () => {
    const home = createFrame(0, 0, 'Home');
    const right = createFrame(1, 0, 'Right');
    const cam = createCameraMove(right.id, 2, 2);
    const items = mapOf(cam);

    expect(cameraOffsetAtTime(0, items, [home, right], home.id).x).toBeCloseTo(0);
    expect(cameraOffsetAtTime(0, items, [home, right], home.id).y).toBeCloseTo(0);
    expect(cameraOffsetAtTime(3, items, [home, right], home.id).x).toBeCloseTo(7.111111);
    expect(cameraOffsetAtTime(4.5, items, [home, right], home.id).x).toBeCloseTo(14.222222);
  });
});

describe('camera pose preview', () => {
  it('delegates interruption to the shared later-start schedule', () => {
    const home = createFrame(0, 0, 'Home');
    const right = createFrame(1, 0, 'Right');
    const a = createCameraMove(right.id, 0, 10);
    a.id = 'a';
    a.targetWidth = 4;
    const b = createCameraMove(home.id, 2, 1);
    b.id = 'b';
    b.targetWidth = 8;
    const items = mapOf(a, b);
    const sampled = cameraPosePreviewAtTime(2, items, [home, right], home.id);
    expect(cameraPosePreviewAtTime(2.5, items, [home, right], home.id).width).toBeLessThan(sampled.width);
    expect(cameraPosePreviewAtTime(2.5, items, [home, right], home.id).width).toBeGreaterThan(8);
    expect(cameraPosePreviewAtTime(9, items, [home, right], home.id).width).toBeCloseTo(8);
  });

  it('excludes delete-marked camera clips at the preview boundary', () => {
    const home = createFrame(0, 0, 'Home');
    const right = createFrame(1, 0, 'Right');
    const deleted = createCameraMove(right.id, 0, 1);
    deleted.id = 'deleted';
    const items = mapOf(deleted);
    const pose = cameraPosePreviewAtTime(1, items, [home, right], home.id, new Set(['deleted']));
    expect(pose.x).toBe(0);
    expect(pose.width).toBeCloseTo(14.222222222222221);
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

  it('exposes eased visual progress without changing the active window', () => {
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

    // Quarter through the 2 s transform: raw progress stays linear.
    const early = activeTextTransformForLine(src, 3.5, items);
    expect(early?.progress).toBeCloseTo(0.25);
    expect(early?.visualProgress).toBeCloseTo(manimSmoothProgress(0.25));
    expect(early?.visualProgress).toBeLessThan(early!.progress);

    // Active window is unchanged: inside at the end edge, null past it.
    expect(activeTextTransformForLine(src, 4, items)?.visualProgress).toBeCloseTo(0.5);
    expect(activeTextTransformForLine(src, 5, items)).toBeNull();
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
    expect(s0?.applyOuterBlinkScale).toBe(true);

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
    expect(st?.textMathChildHighlights).toBeNull();
    expect(st?.applyOuterBlinkScale).toBe(false);
  });

  it('sets math child highlights and piecewise scale for mathSubtargets', () => {
    const item = createTextLine(defaultSceneDefaults(), 0);
    item.id = 'l1';
    item.segments = [
      { text: '$x$', isMath: true, color: '#ffffff', bold: false, italic: false },
    ];
    const blink = createBlinkAnimation([item.id], 0, 1);
    blink.targets[0]!.mathSubtargets = [{ segmentIndex: 0, childIndices: [1] }];
    const items = mapOf(item, blink);

    const st = blinkPreviewForTarget(item.id, 0.5, items);
    expect(st?.textMathChildHighlights).toEqual([
      { segmentIndex: 0, childIndex: 1 },
    ]);
    expect(st?.applyOuterBlinkScale).toBe(false);
  });
});

describe('targetAnimPreviewAccum', () => {
  it('accumulates completed move deltas and interpolates active clip', () => {
    const line = createTextLine(defaultSceneDefaults(), 0);
    line.id = 'L1';

    const a = createTargetAnimation('move', [line.id], 0, 1);
    a.id = 'ta1';
    a.targets = [{ targetId: line.id, dx: 1, dy: 0 }];

    const b = createTargetAnimation('move', [line.id], 2, 1);
    b.id = 'ta2';
    b.targets = [{ targetId: line.id, dx: 0, dy: -0.5 }];

    const items = mapOf(line, a, b);

    const mid = targetAnimPreviewAccum(line.id, 0.5, items);
    expect(mid.dx).toBeCloseTo(0.5);
    expect(mid.dy).toBe(0);

    const afterBoth = targetAnimPreviewAccum(line.id, 10, items);
    expect(afterBoth.dx).toBeCloseTo(1);
    expect(afterBoth.dy).toBeCloseTo(-0.5);
  });

  it('multiplies sequential scale animations', () => {
    const line = createTextLine(defaultSceneDefaults(), 0);
    line.id = 'L1';
    const a = createTargetAnimation('scale', [line.id], 0, 1);
    a.targets = [{ targetId: line.id, scaleFactor: 2 }];
    const items = mapOf(line, a);
    const mid = targetAnimPreviewAccum(line.id, 0.5, items);
    expect(mid.scaleMul).toBeCloseTo(1.5);
    const end = targetAnimPreviewAccum(line.id, 2, items);
    expect(end.scaleMul).toBeCloseTo(2);
  });

  it('normalizes parametric path offsets from the first sample', () => {
    const line = createTextLine(defaultSceneDefaults(), 0);
    line.id = 'L1';
    const a = createTargetAnimation('path', [line.id], 0, 2);
    a.targets = [
      {
        targetId: line.id,
        pathKind: 'parametric',
        parametricPath: {
          jsXExpr: '1 + t',
          jsYExpr: 't * t',
          pyXExpr: '1 + t',
          pyYExpr: 't ** 2',
          tMin: 0,
          tMax: 2,
        },
      },
    ];
    const items = mapOf(line, a);

    const mid = targetAnimPreviewAccum(line.id, 1, items);
    expect(mid.dx).toBeCloseTo(1);
    expect(mid.dy).toBeCloseTo(1);

    const end = targetAnimPreviewAccum(line.id, 3, items);
    expect(end.dx).toBeCloseTo(2);
    expect(end.dy).toBeCloseTo(4);
  });
});
