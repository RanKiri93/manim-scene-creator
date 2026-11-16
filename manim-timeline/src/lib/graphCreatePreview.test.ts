import { describe, expect, it } from 'vitest';
import type { ItemId, SceneItem } from '@/types/scene';
import {
  createAxes,
  createGraphDot,
  createGraphPlot,
  defaultSceneDefaults,
} from '@/store/factories';
import {
  axesArrowPointerMetrics,
  buildAxesCreatePreviewSpec,
  buildAxesTickSegments,
  buildGraphDotPreviewSpec,
  buildPlotCreatePreviewSpec,
  clampedAxesZeroOffsets,
} from './graphCreatePreview';
import { axesCreatePlan } from './axesCreatePlan';

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

  it('before start: nothing drawn', () => {
    const spec = buildAxesCreatePreviewSpec({ axes, time: 9.99, itemsMap, ...geom });
    expect(spec.xAxisPoints.length).toBe(0);
    expect(spec.yAxisPoints.length).toBe(0);
    expect(spec.xTip).toBeNull();
    expect(spec.xTickSegments.length).toBe(0);
  });

  it('draws pieces one after another like Create(axes): x line, x tip, x ticks, ...', () => {
    const plan = axesCreatePlan(axes);
    const at = (slot: number) =>
      buildAxesCreatePreviewSpec({
        axes,
        time: axes.startTime + (slot / plan.members) * axes.duration,
        itemsMap,
        ...geom,
      });
    // Halfway through the first slot: half the x line, nothing else.
    const s0 = at(0.5);
    expect(s0.xAxisPoints[2]).toBeGreaterThan(-geom.axW / 2);
    expect(s0.xAxisPoints[2]).toBeLessThan(0);
    expect(s0.xTip).toBeNull();
    expect(s0.yAxisPoints.length).toBe(0);
    // Halfway through the third slot: tip done, first x tick half drawn.
    const s2 = at(2.5);
    expect(s2.xTip?.opacity).toBe(1);
    expect(s2.xTickSegments.length).toBe(1);
    expect(s2.yAxisPoints.length).toBe(0);
    // Every slot before the y line done: all x ticks and numbers in, y line starting.
    const yLine = plan.parts.find((p) => p.role === 'yLine')!;
    const sy = at(yLine.first + 0.5);
    expect(sy.xTickSegments.length).toBe(plan.xTicks.length);
    expect(sy.xNumberLabels.every((n) => n.opacity === 1)).toBe(true);
    expect(sy.yAxisPoints.length).toBe(4);
    expect(sy.yAxisPoints[1]).toBe(geom.axH / 2); // y line grows bottom to top
    expect(sy.yNumberLabels.length).toBe(0);
    expect(sy.xAxisLabel).toBeNull();
  });

  it('follows Manim tick rules: no origin tick, no tick under the tip', () => {
    const ticks = buildAxesTickSegments({ axes, ...geom });
    expect(ticks.xTickValues).toEqual([-5, -4, -3, -2, -1, 1, 2, 3, 4]);
    expect(ticks.yTickValues).toEqual([-3, -2, -1, 1, 2]);
    // Default tick_size 0.1 is the half length: 0.2 units at 100 px per unit.
    expect(Math.abs(ticks.xTicks[0]![1]! - ticks.xTicks[0]![3]!)).toBeCloseTo(20);
  });

  it('complete: everything drawn', () => {
    const spec = buildAxesCreatePreviewSpec({ axes, time: axes.startTime + axes.duration, itemsMap, ...geom });
    expect(spec.progress).toBe(1);
    expect(spec.xTip?.opacity).toBe(1);
    expect(spec.yTip?.opacity).toBe(1);
    expect(spec.xTickSegments.length).toBe(9);
    expect(spec.yNumberLabels.map((n) => n.text)).toEqual(['-3', '-2', '-1', '1', '2']);
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
    expect(spec.xAxisLabel?.opacity).toBe(1);
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

  it('adds optional live coordinates and boundary projection guides without changing defaults', () => {
    const dot = createGraphDot(); dot.dx = 1; dot.dy = 2;
    const axes = createAxes(defaultSceneDefaults()); axes.xRange = [2, 6, 1]; axes.yRange = [3, 7, 1];
    expect(buildGraphDotPreviewSpec({ dot, axes, ...geom }).projectionGuides).toEqual([]);
    dot.showCoordinates = true; dot.showProjectionGuides = true;
    const spec = buildGraphDotPreviewSpec({ dot, axes, ...geom });
    expect(spec.coordinates).toBe('(1.00, 2.00)');
    expect(spec.projectionGuides).toHaveLength(2);
    expect(spec.projectionGuides[0]?.[2]).toBeCloseTo(20);
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
