import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from './useSceneStore';
import { createAxes, createGraphDotItem, createShape, defaultSceneDefaults } from './factories';
import type { ShapeItem } from '@/types/scene';

describe('removing what a connector follows', () => {
  beforeEach(() => {
    useSceneStore.setState((s) => {
      s.items.clear();
    });
  });

  it('keeps the connector as a plain line where it was', () => {
    const axes = createAxes(defaultSceneDefaults());
    const dot = createGraphDotItem(axes.id, 0);
    dot.dot.dx = 2;
    dot.dot.dy = 1;
    const line = createShape(0);
    line.shapeType = 'line';
    line.endpoints = { start: { kind: 'graphDot', dotId: dot.id }, end: { kind: 'graphDotFoot', dotId: dot.id, axis: 'x' } };
    const s = useSceneStore.getState();
    s.addItem(axes);
    s.addItem(dot);
    s.addItem(line);
    useSceneStore.getState().removeItem(dot.id);
    const after = useSceneStore.getState().items.get(line.id) as ShapeItem;
    expect(after.endpoints).toBeNull();
    expect(after.endX).toBeCloseTo(0);
    expect(after.endY).toBeCloseTo(-1);
    expect(after.y).toBeCloseTo(0.5);
  });
});
