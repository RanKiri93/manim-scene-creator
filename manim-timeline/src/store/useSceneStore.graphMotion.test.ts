import { beforeEach, describe, expect, it } from 'vitest';
import { createAxes, createGraphDotItem, createGraphPlot, createTargetAnimation, defaultFrames, defaultSceneDefaults } from '@/store/factories';
import type { TargetAnimationItem } from '@/types/scene';
import { useSceneStore } from '@/store/useSceneStore';
import { resolveGraphDotPosition } from '@/lib/graphMotion';
import { PROJECT_VERSION } from '@/lib/constants';

describe('graph-follow authoring', () => {
  beforeEach(() => {
    const { frames, startFrameId } = defaultFrames();
    useSceneStore.getState().loadSceneDocument({ defaults: defaultSceneDefaults(), frames, startFrameId, items: [], audioItems: undefined }, PROJECT_VERSION);
    useSceneStore.temporal.getState().clear();
  });

  it('stores and undo/redoes chained graph-follow clips as normal items', () => {
    const axes = createAxes(defaultSceneDefaults()); axes.id = 'axes';
    const plot = createGraphPlot('axes'); plot.id = 'plot'; plot.fn.jsExpr = 'x*x';
    const dot = createGraphDotItem('axes'); dot.id = 'dot';
    const first = createTargetAnimation('graphFollow', ['dot'], 1); first.id = 'first';
    first.targets = [{ targetId: 'dot', graphPlotId: 'plot', targetX: 1, easing: 'linear' }];
    const second = createTargetAnimation('graphFollow', ['dot'], 3); second.id = 'second';
    second.targets = [{ targetId: 'dot', graphPlotId: 'plot', targetX: 2, easing: 'smooth' }];
    const store = useSceneStore.getState();
    [axes, plot, dot, first, second].forEach((item) => store.addItem(item));
    expect(resolveGraphDotPosition({ dot, items: [...useSceneStore.getState().items.values()], time: 3.5 }).point).toEqual({ x: 1.5, y: 2.25 });
    useSceneStore.getState().updateItem('second', { duration: 2 });
    expect((useSceneStore.getState().items.get('second') as TargetAnimationItem).duration).toBe(2);
    useSceneStore.temporal.getState().undo();
    expect((useSceneStore.getState().items.get('second') as TargetAnimationItem).duration).toBe(1);
    useSceneStore.temporal.getState().redo();
    expect((useSceneStore.getState().items.get('second') as TargetAnimationItem).duration).toBe(2);
  });

  it('reports missing graph-dot references through store diagnostics', () => {
    const clip = createTargetAnimation('graphFollow', ['gone'], 1); clip.id = 'orphan';
    clip.targets = [{ targetId: 'gone', graphPlotId: 'missing-plot', targetX: 1 }];
    useSceneStore.getState().addItem(clip);
    expect(useSceneStore.getState().graphMotionDiagnostics('gone')).toEqual(['Graph-follow clip orphan references a missing graph dot.']);
  });

  it('does not block valid graph-follow motion or annotation-only exports after codegen support', () => {
    const dot = createGraphDotItem('axes'); dot.id = 'annotated';
    useSceneStore.getState().addItem(dot);
    expect(useSceneStore.getState().graphFollowExportBlock()).toBeNull();
    useSceneStore.getState().updateItem(dot.id, { dot: { ...dot.dot, showCoordinates: true } });
    expect(useSceneStore.getState().graphFollowExportBlock()).toBeNull();

    const axes = createAxes(defaultSceneDefaults()); axes.id = 'export-axes';
    const plot = createGraphPlot(axes.id); plot.id = 'export-plot'; plot.fn.jsExpr = 'x * x';
    const movingDot = createGraphDotItem(axes.id); movingDot.id = 'export-dot';
    const clip = createTargetAnimation('graphFollow', [movingDot.id], 1); clip.id = 'export-follow';
    clip.targets = [{ targetId: movingDot.id, graphPlotId: plot.id, targetX: 1 }];
    [axes, plot, movingDot, clip].forEach((item) => useSceneStore.getState().addItem(item));
    expect(useSceneStore.getState().graphFollowExportBlock()).toBeNull();
  });

  it('keeps invalid graph-follow diagnostics visible independently of export readiness', () => {
    const axes = createAxes(defaultSceneDefaults()); axes.id = 'invalid-export-axes';
    const plot = createGraphPlot(axes.id); plot.id = 'invalid-export-plot'; plot.fn.jsExpr = 'x * x'; plot.xDomain = [0, 1];
    const dot = createGraphDotItem(axes.id); dot.id = 'invalid-export-dot';
    const clip = createTargetAnimation('graphFollow', [dot.id], 1); clip.id = 'invalid-export-follow';
    clip.targets = [{ targetId: dot.id, graphPlotId: plot.id, targetX: 2 }];
    [axes, plot, dot, clip].forEach((item) => useSceneStore.getState().addItem(item));

    expect(useSceneStore.getState().graphFollowExportBlock()).toBeNull();
    expect(useSceneStore.getState().graphMotionDiagnostics(dot.id, 1.5)).toContain('Motion leaves plot source domain.');
  });

  it('reports a deleted attached source even when the dot has no graph-follow clip', () => {
    const dot = createGraphDotItem('axes'); dot.id = 'orphan-dot';
    dot.dot.attachment = { kind: 'function', graphPlotId: 'deleted-plot', x: 1 };
    useSceneStore.getState().addItem(dot);
    expect(useSceneStore.getState().graphMotionDiagnostics(dot.id)).toEqual(['Attached function plot is missing or uses different axes.']);
  });

  it('recomputes function-attached points after source edits and diagnoses source deletion', () => {
    const axes = createAxes(defaultSceneDefaults()); axes.id = 'source-axes';
    const plot = createGraphPlot(axes.id); plot.id = 'attached-plot'; plot.fn.jsExpr = 'x*x';
    const dot = createGraphDotItem(axes.id); dot.id = 'attached-dot';
    dot.dot.attachment = { kind: 'function', graphPlotId: plot.id, x: 1 };
    [axes, plot, dot].forEach((item) => useSceneStore.getState().addItem(item));
    expect(resolveGraphDotPosition({ dot, items: [...useSceneStore.getState().items.values()], time: 0 }).point).toEqual({ x: 1, y: 1 });
    useSceneStore.getState().updateItem(plot.id, { fn: { ...plot.fn, jsExpr: '3*x' } });
    expect(resolveGraphDotPosition({ dot, items: [...useSceneStore.getState().items.values()], time: 0 }).point).toEqual({ x: 1, y: 3 });
    useSceneStore.getState().removeItem(plot.id);
    expect(useSceneStore.getState().graphMotionDiagnostics(dot.id)[0]).toMatch(/missing/);
  });
});
