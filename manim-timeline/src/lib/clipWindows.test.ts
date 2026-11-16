import { describe, expect, it } from 'vitest';
import type { AudioTrackItem, ItemId, SceneItem } from '@/types/scene';
import {
  createAxes,
  createExitAnimation,
  createGraphPlot,
  createImageItem,
  createSegmentStyle,
  createShape,
  createSurroundingRect,
  createTextLine,
  defaultSceneDefaults,
} from '@/store/factories';
import { exportManimCode } from '@/codegen/manimExporter';
import { clipAnimationWindow, isTransformSourceHiddenAt } from './clipWindows';
import { buildPlotCreatePreviewSpec } from './graphCreatePreview';
import { manimSmooth } from './axesCreatePlan';
import { previewRunTime } from './visualPlaybackPreview';
import { isTransformSourceHiddenInPreview } from './time';

function mapOf(...items: SceneItem[]): Map<ItemId, SceneItem> {
  return new Map(items.map((it) => [it.id, it]));
}

describe('clipAnimationWindow', () => {
  const defaults = defaultSceneDefaults();

  it('spans a text line run time plus its segment pauses', () => {
    const line = createTextLine(defaults, 2);
    line.duration = 1.4;
    const first = createSegmentStyle('a', false, defaults);
    first.waitAfterSec = 0.3;
    line.segments = [first, createSegmentStyle('b', true, defaults)];
    const w = clipAnimationWindow(line, mapOf(line))!;
    expect(w.start).toBe(2);
    expect(w.end).toBeCloseTo(2 + 1.4 + 0.3);
  });

  it('matches the run time the export gives a narrated image', () => {
    const img = createImageItem({ srcUrl: 'blob:x', fileName: 'x.png', mimeType: 'image/png', width: 1, height: 1, startTime: 1 });
    img.duration = 2;
    img.assetRelPath = 'assets/textures/x.png';
    img.audioTrackId = 'v';
    const audio: AudioTrackItem[] = [{
      id: 'v', text: 'v', audioUrl: '/assets/audio/v.wav', assetRelPath: 'assets/audio/v.wav',
      startTime: 1, duration: 3, boundaries: [{ word: 'a', start: 0.1, end: 0.6 }, { word: 'b', start: 0.7, end: 1.2 }],
    }];
    const code = exportManimCode([img], { fullFile: true, defaults, audioItems: audio });
    const emitted = Number(/FadeIn\(image_1\)?,? run_time=([\d.]+)/.exec(code)?.[1]);
    const w = clipAnimationWindow(img, mapOf(img), audio)!;
    expect(Number.isFinite(emitted)).toBe(true);
    expect(w.start).toBe(1);
    expect(w.end - w.start).toBeCloseTo(emitted, 5);
  });

  it('uses runTime for surrounding rects and duration for exit clips', () => {
    const shape = createShape(0);
    const sr = createSurroundingRect([shape.id], 1.5);
    const exit = createExitAnimation([shape.id], 4, 0.7);
    const items = mapOf(shape, sr, exit);
    expect(clipAnimationWindow(sr, items)).toEqual({ start: 1.5, end: 1.95 });
    expect(clipAnimationWindow(exit, items)).toEqual({ start: 4, end: 4.7 });
  });

  it('has no window for items shown at scene start', () => {
    const axes = createAxes(defaults, 0);
    axes.visibleAtSceneStart = true;
    expect(clipAnimationWindow(axes, mapOf(axes))).toBeNull();
  });
});

describe('preview timing follows bound narration like the export', () => {
  const defaults = defaultSceneDefaults();
  // Narration at a0: words 0.1-0.6 and 0.7-1.24. A clip starting on the first word with its own
  // 1 s duration ends within the snap distance of the second word, so export plays it for
  // 1.24 - 0.1 = 1.14 s.
  const voice = (a0: number): AudioTrackItem[] => [{
    id: 'v', text: 'v', audioUrl: '/assets/audio/v.wav', assetRelPath: 'assets/audio/v.wav',
    startTime: a0, duration: 2,
    boundaries: [{ word: 'a', start: 0.1, end: 0.6 }, { word: 'b', start: 0.7, end: 1.24 }],
  }];
  const NARRATED = 1.14;

  it('fades a narrated image in over the narration run time', () => {
    const img = createImageItem({ srcUrl: 'blob:x', fileName: 'x.png', mimeType: 'image/png', width: 1, height: 1, startTime: 1.1 });
    img.duration = 1;
    img.audioTrackId = 'v';
    const audio = voice(1);
    expect(previewRunTime(img, mapOf(img), audio)).toBeCloseTo(NARRATED, 5);
    expect(previewRunTime(img, mapOf(img), audio)).toBeCloseTo(clipAnimationWindow(img, mapOf(img), audio)!.end - 1.1, 5);
  });

  it('creates a narrated plot over the narration run time with Manim smooth easing', () => {
    const axes = createAxes(defaults, 0);
    const plot = createGraphPlot(axes.id, 2.1);
    plot.duration = 1;
    plot.audioTrackId = 'v';
    const audio = voice(2);
    const items = mapOf(axes, plot);
    const w = clipAnimationWindow(plot, items, audio)!;
    expect(w.end - w.start).toBeCloseTo(NARRATED, 5);
    const pts = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];
    const at = (time: number) => buildPlotCreatePreviewSpec({ plot, time, itemsMap: items, fullPoints: pts, audioItems: audio }).progress;
    expect(at(w.start + 0.5 * NARRATED)).toBeCloseTo(0.5, 5);
    expect(at(w.start + 0.25 * NARRATED)).toBeCloseTo(manimSmooth(0.25), 5);
    expect(at(w.start + 0.25 * NARRATED)).toBeLessThan(0.25); // eased, not linear
    expect(at(w.start + 1.05)).toBeLessThan(1); // still drawing after the clip's own 1 s
  });

  it('keeps a transform source until a narrated target has finished morphing', () => {
    const src = createTextLine(defaults, 0);
    src.id = 'src';
    src.raw = 'a';
    const tgt = createTextLine(defaults, 2.1);
    Object.assign(tgt, { id: 'tgt', raw: 'b', duration: 1, animStyle: 'transform', audioTrackId: 'v' });
    tgt.transformConfig = { sourceLineId: 'src', segmentPairs: {}, unmappedSourceBehavior: 'fade_out', unmappedTargetBehavior: 'fade_in' };
    const audio = voice(2);
    const items = mapOf(src, tgt);
    // Between the clip's own end (3.1) and the narrated end (3.24) export is still morphing.
    expect(isTransformSourceHiddenInPreview(src, 3.15, items)).toBe(true);
    expect(isTransformSourceHiddenAt(src, 3.15, items, audio)).toBe(false);
    expect(isTransformSourceHiddenAt(src, 3.3, items, audio)).toBe(true);
  });
});
