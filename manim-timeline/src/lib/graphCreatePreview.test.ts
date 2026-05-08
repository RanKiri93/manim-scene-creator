import { describe, expect, it } from 'vitest';
import type { ItemId, SceneItem } from '@/types/scene';
import {
  createAxes,
  createGraphDot,
  createGraphPlot,
  defaultSceneDefaults,
} from '@/store/factories';
import {
  AXES_PREVIEW_PHASE_X_END,
  axesArrowPointerMetrics,
  buildAxesCreatePreviewSpec,
  buildAxesTickSegments,
  buildGraphDotPreviewSpec,
  buildPlotCreatePreviewSpec,
  clampedAxesZeroOffsets,
  densifiedHorizontalAxisPoints,
  densifiedVerticalAxisPoints,
} from './graphCreatePreview';

describe('buildAxesCreatePreviewSpec', () => {
  const def = defaultSceneDefaults();
  const axes = createAxes(def, 10);
  axes.duration = 20;
  axes.includeNumbers = true;
  const itemsMap = new Map<ItemId, SceneItem>([[axes.id, axes]]);

  const geom = {
    axW: 200,
    axH: 120,
    ox: 100,
    oy: 60,
    xMin: -5,
    xMax: 5,
    yMin: -3,
    yMax: 3,
    scenePxPerUnit: 100,
  } as const;

  it('before start: axis lines empty, no reveal head', () => {
    const spec = buildAxesCreatePreviewSpec({
      axes,
      time: 9.99,
      itemsMap,
      ...geom,
    });
    expect(spec.xAxisPoints.length).toBe(0);
    expect(spec.yAxisPoints.length).toBe(0);
    expect(spec.revealHead).toBeNull();
    expect(spec.tickOpacity).toBe(0);
  });

  it('at mid X phase: grows horizontal axis first', () => {
    const progressMidX = (AXES_PREVIEW_PHASE_X_END * 1) / 2;
    const time = axes.startTime + progressMidX * axes.duration;
    const spec = buildAxesCreatePreviewSpec({
      axes,
      time,
      itemsMap,
      ...geom,
    });
    expect(spec.xAxisPoints.length).toBeGreaterThanOrEqual(4);
    expect(spec.yAxisPoints.length).toBe(0);
    expect(spec.revealHead).not.toBeNull();
    const full = densifiedHorizontalAxisPoints(geom.axW, geom.axH, geom.oy);
    expect(spec.xAxisPoints.length).toBeLessThan(full.length);
  });

  it('at 60pct create: horizontal done, vertical partial', () => {
    const p = 0.6;
    const time = axes.startTime + p * axes.duration;
    const spec = buildAxesCreatePreviewSpec({
      axes,
      time,
      itemsMap,
      ...geom,
    });
    const fullX = densifiedHorizontalAxisPoints(geom.axW, geom.axH, geom.oy);
    expect(spec.xAxisPoints.length).toBe(fullX.length);
    expect(spec.yAxisPoints.length).toBeGreaterThanOrEqual(4);
    const fullLen = densifiedHorizontalAxisPoints(
      geom.axW,
      geom.axH,
      geom.oy,
    ).length;
    expect(fullLen).toBeGreaterThan(4);
    expect(spec.revealHead).not.toBeNull();
  });

  it('near end: tick opacity rises', () => {
    const time = axes.startTime + 0.9 * axes.duration;
    const spec = buildAxesCreatePreviewSpec({
      axes,
      time,
      itemsMap,
      ...geom,
    });
    expect(spec.tickOpacity).toBeGreaterThan(0.2);
    expect(spec.tickOpacity).toBeLessThanOrEqual(1);
    const ticks = buildAxesTickSegments({ axes, ...geom });
    expect(ticks.xTicks.length).toBeGreaterThan(0);
    expect(ticks.yTicks.length).toBeGreaterThan(0);
  });

  it('complete: reveal head clears', () => {
    const time = axes.startTime + axes.duration;
    const spec = buildAxesCreatePreviewSpec({
      axes,
      time,
      itemsMap,
      ...geom,
    });
    expect(spec.progress).toBe(1);
    expect(spec.revealHead).toBeNull();
  });

  it('complete: pointer metrics scale with pxPerUnit and tipHeight', () => {
    const time = axes.startTime + axes.duration;
    const specWide = buildAxesCreatePreviewSpec({
      axes,
      time,
      itemsMap,
      ...geom,
      pxPerUnitX: 200,
      pxPerUnitY: 50,
    });
    expect(specWide.xPointerLength).toBeGreaterThan(specWide.yPointerLength);
    const specDefault = buildAxesCreatePreviewSpec({
      axes,
      time,
      itemsMap,
      ...geom,
    });
    const axesLongTip = structuredClone(axes);
    axesLongTip.tipHeight = 0.6;
    const map2 = new Map(itemsMap);
    map2.set(axesLongTip.id, axesLongTip);
    const specLong = buildAxesCreatePreviewSpec({
      axes: axesLongTip,
      time,
      itemsMap: map2,
      ...geom,
    });
    expect(specLong.xPointerLength).toBeGreaterThan(specDefault.xPointerLength);
  });

  it('axis name labels appear when animation finished', () => {
    const time = axes.startTime + axes.duration;
    const spec = buildAxesCreatePreviewSpec({
      axes,
      time,
      itemsMap,
      ...geom,
    });
    expect(spec.xAxisLabel?.text).toBe('x');
    expect(spec.yAxisLabel?.text).toBe('y');
    expect(spec.xLabelOpacity).toBe(1);
  });

  it('no tick numbers when includeNumbers is false', () => {
    const noNum = structuredClone(axes);
    noNum.includeNumbers = false;
    const map2 = new Map<ItemId, SceneItem>([[noNum.id, noNum]]);
    const time = noNum.startTime + noNum.duration;
    const spec = buildAxesCreatePreviewSpec({
      axes: noNum,
      time,
      itemsMap: map2,
      ...geom,
    });
    expect(spec.xNumberLabels.length).toBe(0);
    expect(spec.yNumberLabels.length).toBe(0);
    expect(spec.xTickSegments.length).toBeGreaterThan(0);
  });

  it('clamps axes to the frame edge when zero is outside the ranges', () => {
    const positiveAxes = createAxes(def, 0);
    positiveAxes.xRange = [1, 5, 1];
    positiveAxes.yRange = [2, 8, 1];
    const { ox, oy } = clampedAxesZeroOffsets({
      xRange: positiveAxes.xRange,
      yRange: positiveAxes.yRange,
      axW: geom.axW,
      axH: geom.axH,
    });
    expect(ox).toBe(0);
    expect(oy).toBe(geom.axH);
  });

  it('densifies vertical axis from bottom to top so arrow tips point upward', () => {
    const pts = densifiedVerticalAxisPoints(geom.axW, geom.axH, geom.ox, 4);
    expect(pts[1]).toBe(geom.axH / 2);
    expect(pts[pts.length - 1]).toBe(-geom.axH / 2);
  });
});

describe('axesArrowPointerMetrics', () => {
  it('returns wider pointers than stroke', () => {
    const def = defaultSceneDefaults();
    const axes = createAxes(def, 0);
    const m = axesArrowPointerMetrics({
      axes,
      axisStrokeWidth: 2,
      pxPerUnitX: 100,
      pxPerUnitY: 100,
    });
    expect(m.xPointerWidth).toBeGreaterThan(m.xPointerLength * 0.5);
    expect(m.xPointerLength).toBeGreaterThanOrEqual(10);
  });

  it('does not hide explicit small tip heights behind the default floor', () => {
    const def = defaultSceneDefaults();
    const small = createAxes(def, 0);
    small.tipHeight = 0.05;
    const larger = createAxes(def, 0);
    larger.tipHeight = 0.1;

    const smallMetrics = axesArrowPointerMetrics({
      axes: small,
      axisStrokeWidth: 1,
      pxPerUnitX: 100,
      pxPerUnitY: 100,
    });
    const largerMetrics = axesArrowPointerMetrics({
      axes: larger,
      axisStrokeWidth: 1,
      pxPerUnitX: 100,
      pxPerUnitY: 100,
    });

    expect(smallMetrics.xPointerLength).toBeCloseTo(5);
    expect(largerMetrics.xPointerLength).toBeCloseTo(10);
    expect(largerMetrics.xPointerLength).toBeGreaterThan(
      smallMetrics.xPointerLength,
    );
  });

  it('applies explicit tip width separately from height', () => {
    const def = defaultSceneDefaults();
    const narrow = createAxes(def, 0);
    narrow.tipHeight = 0.2;
    narrow.tipWidth = 0.08;
    const m = axesArrowPointerMetrics({
      axes: narrow,
      axisStrokeWidth: 1,
      pxPerUnitX: 100,
      pxPerUnitY: 100,
    });
    expect(m.xPointerLength).toBeCloseTo(20);
    expect(m.xPointerWidth).toBeCloseTo(8);
  });
});

describe('buildGraphDotPreviewSpec', () => {
  const geom = {
    axW: 200,
    axH: 120,
    xMin: -5,
    xMax: 5,
    yMin: -3,
    yMax: 3,
    scenePxPerUnit: 100,
  } as const;

  it('maps graph coordinates and Manim radius to local canvas pixels', () => {
    const dot = createGraphDot();
    dot.dx = 2.5;
    dot.dy = 1.5;
    dot.radius = 0.08;
    const spec = buildGraphDotPreviewSpec({ dot, ...geom });
    expect(spec.x).toBeCloseTo(50);
    expect(spec.y).toBeCloseTo(-30);
    expect(spec.radius).toBeCloseTo(8);
  });

  it('places labels in the requested Manim direction with scene-unit buff', () => {
    const dot = createGraphDot();
    dot.label = 'A';
    dot.labelDir = 'RIGHT';
    const spec = buildGraphDotPreviewSpec({ dot, ...geom });
    expect(spec.label).not.toBeNull();
    expect(spec.label!.x).toBeGreaterThan(spec.x + spec.radius);

    dot.labelDir = 'UP';
    const up = buildGraphDotPreviewSpec({ dot, ...geom });
    expect(up.label!.y).toBeLessThan(up.y - up.radius);
  });

  it('omits blank labels', () => {
    const dot = createGraphDot();
    dot.label = '   ';
    const spec = buildGraphDotPreviewSpec({ dot, ...geom });
    expect(spec.label).toBeNull();
  });
});

describe('buildPlotCreatePreviewSpec', () => {
  const def = defaultSceneDefaults();
  const ax = createAxes(def, 0);
  ax.duration = 5;
  const plot = createGraphPlot(ax.id, 3);
  plot.duration = 10;

  function fullLine(): number[] {
    const out: number[] = [];
    for (let i = 0; i <= 80; i++) {
      const u = i / 80;
      out.push(u * 200 - 100, u * 100 - 50);
    }
    return out;
  }

  it(' midway: prefix path and reveal head at endpoint', () => {
    const map = new Map<ItemId, SceneItem>([
      [ax.id, ax],
      [plot.id, plot],
    ]);
    const pts = fullLine();
    const specMid = buildPlotCreatePreviewSpec({
      plot,
      time: plot.startTime + plot.duration / 2,
      itemsMap: map,
      fullPoints: pts,
    });
    expect(specMid.points.length).toBeGreaterThanOrEqual(4);
    expect(specMid.points.length).toBeLessThan(pts.length);
    expect(specMid.revealHead).not.toBeNull();
    expect(specMid.points[specMid.points.length - 2]).toBe(
      specMid.revealHead!.x,
    );
  });

  it('after clip: full path, no reveal head', () => {
    const map = new Map<ItemId, SceneItem>([
      [ax.id, ax],
      [plot.id, plot],
    ]);
    const pts = fullLine();
    const spec = buildPlotCreatePreviewSpec({
      plot,
      time: plot.startTime + plot.duration + 1,
      itemsMap: map,
      fullPoints: pts,
    });
    expect(spec.points.length).toBe(pts.length);
    expect(spec.revealHead).toBeNull();
  });
});
