import { describe, expect, it } from 'vitest';
import type { SceneItem } from '@/types/scene';
import { anchorItemIdFor, canvasItemNodeId, placeAboveAnchor, unionRects } from './selectionAnchor';

const item = (fields: Record<string, unknown>) => fields as unknown as SceneItem;

describe('anchorItemIdFor', () => {
  it('uses the object itself for stage objects', () => {
    for (const kind of ['textLine', 'shape', 'image', 'surroundingRect', 'axes']) {
      expect(anchorItemIdFor(item({ id: 'a1', kind }))).toBe('a1');
    }
  });

  it('uses the axes for graph parts', () => {
    expect(anchorItemIdFor(item({ id: 'd1', kind: 'graphDot', axesId: 'ax1' }))).toBe('ax1');
    expect(anchorItemIdFor(item({ id: 'p1', kind: 'graphPlot', axesId: 'ax1' }))).toBe('ax1');
  });

  it('has no anchor for clips', () => {
    expect(anchorItemIdFor(item({ id: 'e1', kind: 'exit_animation' }))).toBeNull();
    expect(anchorItemIdFor(item({ id: 'c1', kind: 'camera_move' }))).toBeNull();
  });

  it('builds a stable node id', () => {
    expect(canvasItemNodeId('x')).toBe('scene-item-x');
  });
});

describe('unionRects', () => {
  it('covers every rect', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([
      { left: 10, top: 20, right: 30, bottom: 40 },
      { left: 5, top: 25, right: 50, bottom: 35 },
    ])).toEqual({ left: 5, top: 20, right: 50, bottom: 40 });
  });
});

describe('placeAboveAnchor', () => {
  const container = { width: 400, height: 300 };
  const bar = { width: 100, height: 30 };

  it('centres the bar above the selection', () => {
    expect(placeAboveAnchor({ left: 150, top: 100, right: 250, bottom: 150 }, bar, container)).toEqual({ left: 150, top: 62 });
  });

  it('flips below when there is no room above', () => {
    expect(placeAboveAnchor({ left: 150, top: 10, right: 250, bottom: 60 }, bar, container).top).toBe(68);
  });

  it('stays inside the container horizontally', () => {
    expect(placeAboveAnchor({ left: 0, top: 100, right: 20, bottom: 120 }, bar, container).left).toBe(4);
    expect(placeAboveAnchor({ left: 380, top: 100, right: 400, bottom: 120 }, bar, container).left).toBe(296);
  });

  it('pins to the top when the selection fills the view', () => {
    expect(placeAboveAnchor({ left: 0, top: 0, right: 400, bottom: 300 }, bar, container).top).toBe(4);
  });
});
