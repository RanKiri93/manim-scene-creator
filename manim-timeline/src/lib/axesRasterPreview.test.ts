import { describe, expect, it } from 'vitest';
import type { ItemId, SceneItem } from '@/types/scene';
import { createAxes, defaultSceneDefaults } from '@/store/factories';
import { axesPreviewVisualKey } from '@/lib/axesPreviewRequest';
import { axesRasterGeometry } from './axesRasterPreview';

function freshRasterAxes() {
  const axes = createAxes(defaultSceneDefaults(), 0);
  axes.duration = 2;
  axes.axisPreviewDataUrl = 'data:image/png;base64,AAA';
  axes.axisPreviewBounds = {
    left: -2,
    right: 3,
    top: 1.5,
    bottom: -1,
    offsetInkX: 0,
    offsetInkY: 0,
  };
  axes.axisPreviewHash = axesPreviewVisualKey(axes);
  return axes;
}

function mapOf(...items: SceneItem[]): Map<ItemId, SceneItem> {
  return new Map(items.map((it) => [it.id, it]));
}

describe('axes raster preview', () => {
  it('returns null without a preview data URL', () => {
    const axes = freshRasterAxes();
    axes.axisPreviewDataUrl = null;
    expect(
      axesRasterGeometry({
        axes,
        time: 99,
        itemsMap: mapOf(axes),
        pxPerUnitX: 50,
        pxPerUnitY: 50,
      }),
    ).toBeNull();
  });

  it('returns null without preview bounds', () => {
    const axes = freshRasterAxes();
    axes.axisPreviewBounds = null;
    expect(
      axesRasterGeometry({
        axes,
        time: 99,
        itemsMap: mapOf(axes),
        pxPerUnitX: 50,
        pxPerUnitY: 50,
      }),
    ).toBeNull();
  });

  it('returns null when the cached hash is stale', () => {
    const axes = freshRasterAxes();
    axes.axisStrokeWidth = 4;
    // Hash still reflects the older visual settings.
    expect(axes.axisPreviewHash).not.toBe(axesPreviewVisualKey(axes));
    expect(
      axesRasterGeometry({
        axes,
        time: 99,
        itemsMap: mapOf(axes),
        pxPerUnitX: 50,
        pxPerUnitY: 50,
      }),
    ).toBeNull();
  });

  it('returns null while the axes Create animation is in progress', () => {
    const axes = freshRasterAxes();
    const midCreate = axes.startTime + axes.duration / 2;
    expect(
      axesRasterGeometry({
        axes,
        time: midCreate,
        itemsMap: mapOf(axes),
        pxPerUnitX: 50,
        pxPerUnitY: 50,
      }),
    ).toBeNull();
  });

  it('returns geometry immediately for visibleAtSceneStart axes', () => {
    const axes = freshRasterAxes();
    axes.visibleAtSceneStart = true;
    const geom = axesRasterGeometry({
      axes,
      time: axes.startTime,
      itemsMap: mapOf(axes),
      pxPerUnitX: 50,
      pxPerUnitY: 40,
    });
    expect(geom).not.toBeNull();
    expect(geom!.x).toBeCloseTo(-2 * 50);
    expect(geom!.y).toBeCloseTo(-1.5 * 40);
    expect(geom!.width).toBeCloseTo(5 * 50);
    expect(geom!.height).toBeCloseTo(2.5 * 40);
  });

  it('maps Manim-unit ink bounds into local Konva geometry', () => {
    const axes = freshRasterAxes();
    const geom = axesRasterGeometry({
      axes,
      time: axes.startTime + axes.duration,
      itemsMap: mapOf(axes),
      pxPerUnitX: 50,
      pxPerUnitY: 40,
    });
    expect(geom).toEqual({
      x: -100,
      y: -60,
      width: 250,
      height: 100,
    });
  });
});
