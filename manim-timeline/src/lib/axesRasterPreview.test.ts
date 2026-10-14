import { describe, expect, it } from 'vitest';
import type { ItemId, SceneItem } from '@/types/scene';
import { createAxes, defaultSceneDefaults } from '@/store/factories';
import { axesPreviewVisualKey } from '@/lib/axesPreviewRequest';
import { axesRasterGeometry, axesRasterGraphToLocal, axesVectorOverlayOffset, axesOverlayPoint } from './axesRasterPreview';

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
    metadataVersion: 1,
    originX: 0.2,
    originY: -0.1,
    xUnitX: 1,
    xUnitY: 0,
    yUnitX: 0,
    yUnitY: 1,
    coordLeft: -4.8,
    coordRight: 5.2,
    coordTop: 2.9,
    coordBottom: -3.1,
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

  it('falls back to vectors for cached bounds without versioned graph anchors', () => {
    const axes = freshRasterAxes();
    delete axes.axisPreviewBounds!.metadataVersion;
    expect(axesRasterGeometry({ axes, time: 99, itemsMap: mapOf(axes), pxPerUnitX: 50, pxPerUnitY: 50 })).toBeNull();
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
      graphOrigin: { x: 10, y: 4 },
      graphXBasis: { x: 50, y: -0 },
      graphYBasis: { x: 0, y: -40 },
    });
  });

  it('maps graph origin and the exact sin(1) point using server anchors, not crop center', () => {
    const axes = freshRasterAxes();
    axes.xRange = [-5, 5, 1]; axes.yRange = [-3, 3, 1];
    axes.axisPreviewBounds = {
      ...axes.axisPreviewBounds!, left: -5.288889, right: 5.288889, top: 3.148148, bottom: -3.148148,
      originX: 0.1846624, originY: -0.0016407, xUnitX: 1, xUnitY: 0, yUnitX: 0, yUnitY: 1,
      coordLeft: -4.8153376, coordRight: 5.1846624, coordTop: 2.9983593, coordBottom: -3.0016407,
    };
    axes.axisPreviewHash = axesPreviewVisualKey(axes);
    const geometry = axesRasterGeometry({ axes, time: 99, itemsMap: mapOf(axes), pxPerUnitX: 100, pxPerUnitY: 100 })!;
    expect(geometry.graphOrigin).toEqual({ x: 18.46624, y: 0.16407 });
    const sinPoint = axesRasterGraphToLocal(geometry, 1, Math.sin(1));
    expect(sinPoint.x).toBeCloseTo(118.46624);
    expect(sinPoint.y).toBeCloseTo(-83.98303, 3);
    expect(geometry.graphOrigin.x).not.toBeCloseTo((geometry.x + geometry.width / 2));
    const vectorOffset = axesVectorOverlayOffset({ geometry, xMin: -5, xMax: 5, yMin: -3, yMax: 3, axW: 1000, axH: 600 });
    const vectorOrigin = { x: 0 + vectorOffset.x, y: 0 + vectorOffset.y };
    const vectorSin = { x: 100 + vectorOffset.x, y: -Math.sin(1) * 100 + vectorOffset.y };
    expect(vectorOrigin).toEqual(geometry.graphOrigin);
    expect(vectorSin.x).toBeCloseTo(sinPoint.x);
    expect(vectorSin.y).toBeCloseTo(sinPoint.y);
    expect(axesOverlayPoint({ point: { x: 1, y: Math.sin(1) }, geometry, rasterActive: true, vectorOffset, xMin: -5, xMax: 5, yMin: -3, yMax: 3, axW: 1000, axH: 600 })).toMatchObject({ x: sinPoint.x, y: sinPoint.y });
    const vectorLocal = axesOverlayPoint({ point: { x: 1, y: Math.sin(1) }, geometry, rasterActive: false, vectorOffset, xMin: -5, xMax: 5, yMin: -3, yMax: 3, axW: 1000, axH: 600 });
    expect({ x: vectorLocal.x + vectorOffset.x, y: vectorLocal.y + vectorOffset.y }).toMatchObject({ x: sinPoint.x, y: sinPoint.y });
  });
});
