import { describe, expect, it } from 'vitest';
import type { ItemId, SceneItem } from '@/types/scene';
import {
  createAxes,
  createGraphPlot,
  defaultSceneDefaults,
} from '@/store/factories';
import { clipPolylineByProgress, createProgress } from './createPlaybackPreview';

describe('clipPolylineByProgress', () => {
  const pts = [0, 0, 5, 0, 10, 0, 10, 5]; // 4 vertices

  it('returns empty at progress 0', () => {
    expect(clipPolylineByProgress(pts, 0)).toEqual([]);
  });

  it('returns full polyline at progress 1', () => {
    expect(clipPolylineByProgress(pts, 1)).toEqual(pts);
    expect(clipPolylineByProgress(pts, 2)).toEqual(pts);
  });

  it('returns a strict prefix slice at fractional progress', () => {
    const out = clipPolylineByProgress(pts, 0.5);
    expect(out.length).toBeGreaterThanOrEqual(4);
    expect(out.length).toBeLessThanOrEqual(pts.length);
    expect(pts.slice(0, out.length)).toEqual(out);
  });
});

describe('createProgress', () => {
  const emptyMap = new Map<ItemId, SceneItem>();
  const def = defaultSceneDefaults();

  it('returns 0 before effective start', () => {
    const ax = createAxes(def, 5);
    expect(createProgress(ax, 4.9, emptyMap)).toBe(0);
  });

  it('returns value in (0,1) during duration', () => {
    const ax = createAxes(def, 2);
    ax.duration = 4;
    const p = createProgress(ax, 4, emptyMap); // elapsed 2 of 4
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
    expect(p).toBeCloseTo(0.5, 8);
  });

  it('returns 1 after run segment ends', () => {
    const ax = createAxes(def, 1);
    ax.duration = 2;
    expect(createProgress(ax, 4, emptyMap)).toBe(1);
  });

  it('returns 1 immediately when duration is non-positive', () => {
    const plotAxes = createAxes(def, 0);
    const plot = createGraphPlot(plotAxes.id, 1);
    plot.duration = 0;
    expect(createProgress(plot, 1, emptyMap)).toBe(1);
  });
});
