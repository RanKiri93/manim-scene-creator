import { describe, expect, it } from 'vitest';
import { FRAME_W } from '@/lib/constants';
import { cameraObjectSnapshotBounds, fitCameraObjectSnapshot } from '@/lib/cameraBounds';
import { axesPreviewVisualKey } from '@/lib/axesPreviewRequest';
import {
  createAxes,
  createFrame,
  createImageItem,
  createShape,
  createTargetAnimation,
  createTextLine,
  defaultSceneDefaults,
} from '@/store/factories';
import type { MeasureResult, SceneItem } from '@/types/scene';

const home = createFrame(0, 0, 'Home');
const right = createFrame(1, 1, 'Axis 2');
const frames = [home, right];

function mapOf(...items: SceneItem[]): Map<string, SceneItem> {
  return new Map(items.map((item) => [item.id, item]));
}

function measure(): MeasureResult {
  return {
    width: 3,
    height: 1,
    widthInk: 2,
    heightInk: 0.5,
    offsetInkX: 0.5,
    offsetInkY: -0.1,
    inkLeftX: -0.5,
    inkRightX: 1.5,
    inkTopY: 0.35,
    inkBottomY: -0.15,
    bboxLeft: -1.5,
    bboxRight: 1.5,
    bboxTop: 0.5,
    bboxBottom: -0.5,
    pngBase64: null,
    pngWidth: null,
    pngHeight: null,
    segmentMeasures: null,
    mathChildMeasures: null,
  };
}

describe('camera object snapshot bounds', () => {
  it('uses current valid axes ink bounds on a non-origin frame', () => {
    const axes = createAxes(defaultSceneDefaults(), 0);
    axes.visibleAtSceneStart = true;
    axes.frameId = right.id;
    axes.x = 1;
    axes.axisPreviewBounds = { left: -4, right: 5, bottom: -2, top: 3, offsetInkX: 0, offsetInkY: 0 };
    axes.axisPreviewHash = axesPreviewVisualKey(axes);
    const result = cameraObjectSnapshotBounds(axes.id, mapOf(axes), frames, home.id, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targetFrameId).toBe(right.id);
    expect(result.bounds.left).toBeCloseTo(FRAME_W + 1 - 4);
    expect(result.bounds.right).toBeCloseTo(FRAME_W + 1 + 5);
  });

  it('rejects stale or missing axes preview bounds', () => {
    const axes = createAxes(defaultSceneDefaults(), 0);
    axes.visibleAtSceneStart = true;
    axes.axisPreviewBounds = { left: -1, right: 1, bottom: -1, top: 1, offsetInkX: 0, offsetInkY: 0 };
    axes.axisPreviewHash = 'stale';
    expect(cameraObjectSnapshotBounds(axes.id, mapOf(axes), frames, home.id, 3).ok).toBe(false);
  });

  it('uses scaled Hebrew ink edges rather than a centered guessed box', () => {
    const line = createTextLine(defaultSceneDefaults(), 0);
    line.visibleAtSceneStart = true;
    line.frameId = right.id;
    line.x = 2;
    line.scale = 2;
    line.measure = measure();
    const result = cameraObjectSnapshotBounds(line.id, mapOf(line), frames, home.id, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bounds.left).toBeCloseTo(FRAME_W + 2 - 1);
    expect(result.bounds.right).toBeCloseTo(FRAME_W + 2 + 3);
    expect(result.bounds.top).toBeCloseTo(-7.3);
    expect(result.bounds.bottom).toBeCloseTo(-8.3);
  });

  it('rotates scaled shape and image corners', () => {
    const shape = createShape(0);
    shape.visibleAtSceneStart = true;
    shape.shapeType = 'rectangle';
    shape.width = 2;
    shape.height = 1;
    shape.scale = 2;
    shape.rotationDeg = 90;
    const image = createImageItem({ srcUrl: 'blob:x', fileName: 'x.png', mimeType: 'image/png', width: 4, height: 2, startTime: 0 });
    image.visibleAtSceneStart = true;
    image.rotationDeg = 90;
    const shapeResult = cameraObjectSnapshotBounds(shape.id, mapOf(shape), frames, home.id, 1);
    const imageResult = cameraObjectSnapshotBounds(image.id, mapOf(image), frames, home.id, 1);
    expect(shapeResult.ok && shapeResult.bounds.right - shapeResult.bounds.left).toBeCloseTo(2);
    expect(shapeResult.ok && shapeResult.bounds.top - shapeResult.bounds.bottom).toBeCloseTo(4);
    expect(imageResult.ok && imageResult.bounds.right - imageResult.bounds.left).toBeCloseTo(2);
  });

  it('uses actual asymmetric polyline points', () => {
    const shape = createShape(0);
    shape.visibleAtSceneStart = true;
    shape.shapeType = 'polyline';
    shape.points = [{ x: 1, y: 2 }, { x: 3, y: -1 }];
    shape.rotationDeg = 0;
    const result = cameraObjectSnapshotBounds(shape.id, mapOf(shape), frames, home.id, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bounds.left).toBeCloseTo(1);
    expect(result.bounds.right).toBeCloseTo(3);
    expect(result.bounds.bottom).toBeCloseTo(-1);
    expect(result.bounds.top).toBeCloseTo(2);
  });

  it('rejects effect states and graph overlays', () => {
    const shape = createShape(0);
    shape.visibleAtSceneStart = true;
    const effect = createTargetAnimation('scale', [shape.id], 0, 1);
    expect(cameraObjectSnapshotBounds(shape.id, mapOf(shape, effect), frames, home.id, 2).ok).toBe(false);
  });

  it('uses 0.3 padding by default and supports an explicit zero-padding fit', () => {
    const shape = createShape(0);
    shape.visibleAtSceneStart = true;
    shape.shapeType = 'rectangle';
    shape.width = 2;
    shape.height = 1;
    const items = mapOf(shape);
    const defaultFit = fitCameraObjectSnapshot(shape.id, items, frames, home.id, 1);
    const zeroFit = fitCameraObjectSnapshot(shape.id, items, frames, home.id, 1, 0);
    expect(defaultFit.ok).toBe(true);
    expect(zeroFit.ok).toBe(true);
    if (!defaultFit.ok || !zeroFit.ok) return;
    expect(defaultFit.destination.width).toBeGreaterThan(zeroFit.destination.width);
    expect(zeroFit.destination.width).toBeCloseTo(2);
    expect(zeroFit.viewport.left).toBeCloseTo(-1);
    expect(zeroFit.viewport.right).toBeCloseTo(1);
    expect(zeroFit.viewport.top - zeroFit.viewport.bottom).toBeCloseTo(2 * 8 / FRAME_W);
  });

  it('returns a saved snapshot that does not retarget after source edits', () => {
    const shape = createShape(0);
    shape.visibleAtSceneStart = true;
    shape.shapeType = 'rectangle';
    const result = fitCameraObjectSnapshot(shape.id, mapOf(shape), frames, home.id, 1, 0);
    const saved = structuredClone(result);
    shape.x = 8;
    shape.width = 9;
    expect(result).toEqual(saved);
  });
});
