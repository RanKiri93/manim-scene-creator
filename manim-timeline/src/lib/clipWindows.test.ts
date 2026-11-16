import { describe, expect, it } from 'vitest';
import type { AudioTrackItem, ItemId, SceneItem } from '@/types/scene';
import {
  createAxes,
  createExitAnimation,
  createImageItem,
  createSegmentStyle,
  createShape,
  createSurroundingRect,
  createTextLine,
  defaultSceneDefaults,
} from '@/store/factories';
import { exportManimCode } from '@/codegen/manimExporter';
import { clipAnimationWindow } from './clipWindows';

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
