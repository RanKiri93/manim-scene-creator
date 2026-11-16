import type {
  AudioTrackItem,
  AxesItem,
  GraphCurveItem,
  GraphDot,
  GraphPlotItem,
  ItemId,
  SceneItem,
} from '@/types/scene';
import { clipPolylineByProgress } from '@/lib/createPlaybackPreview';
import { clipWindowAlpha } from '@/lib/clipWindows';
import { effectiveStart } from '@/lib/time';
import { graphProjectionGuides } from '@/lib/graphMotion';
import {
  axesCreateAlpha,
  axesCreatePartProgress,
  axesCreatePlan,
  manimSmooth,
  type AxesCreatePartRole,
} from '@/lib/axesCreatePlan';
import { buildGraphAnnotationLayout, type GraphTextAnnotationSpec } from '@/lib/graphAnnotationLayout';

/** Manim `NumberLine` default `tick_size` (half the tick length, scene units). */
const DEFAULT_TICK_SIZE_SCENE = 0.1;

/** Manim `NumberLine` default `stroke_width`; Cairo draws `width * 0.01` scene units. */
const DEFAULT_AXIS_STROKE_WIDTH = 2;
const MANIM_STROKE_UNITS_PER_WIDTH = 0.01;

/** Manim gap between an axis and its numbers (`line_to_number_buff`) and labels (export). */
const NUMBER_BUFF_SCENE = 0.25;
const LABEL_BUFF_SCENE = 0.25;

/**
 * Canvas font size (scene units) whose glyphs match Manim at `font_size=36`: digits are
 * ~0.257 tall (`DecimalNumber`), a text-mode `HebrewMathLine` "x" ~0.198 (export labels).
 */
const NUMBER_EM_SCENE_AT_36 = 0.36;
const LABEL_EM_SCENE = 0.38;

/** Manim `NumberLine` default `tip_height` / `tip_width` (scene units) when unset. */
const DEFAULT_TIP_HEIGHT_SCENE = 0.35;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function clampedAxesZeroOffsets(args: {
  xRange: readonly [number, number, number];
  yRange: readonly [number, number, number];
  axW: number;
  axH: number;
}): { ox: number; oy: number } {
  const { xRange, yRange, axW, axH } = args;
  const [xMin, xMax] = xRange;
  const [yMin, yMax] = yRange;
  const xSpan = xMax - xMin;
  const ySpan = yMax - yMin;
  const ox = xSpan > 0 ? clamp01(-xMin / xSpan) * axW : axW / 2;
  const oy = ySpan > 0 ? clamp01(yMax / ySpan) * axH : axH / 2;
  return { ox, oy };
}

/** Last vertex of polyline [x,y,...] */
function polyEndpoint(pts: number[]): { x: number; y: number } | null {
  const n = pts.length;
  if (n < 4) return null;
  return { x: pts[n - 2]!, y: pts[n - 1]! };
}

export interface AxesCreatePreviewSpec {
  progress: number;
  axisStrokeColor: string;
  axisStrokeWidth: number;
  tickStrokeColor: string;
  tickStrokeWidth: number;
  numberColor: string;
  numberFontSize: number;
  /** Konva Arrow head sizes (pixels), separated so x/y scale with aspect ratio. */
  xPointerLength: number;
  xPointerWidth: number;
  yPointerLength: number;
  yPointerWidth: number;
  axisLabelFontSize: number;
  axisLabelColor: string;
  /** Axis lines as drawn so far (tip excluded). */
  xAxisPoints: number[];
  yAxisPoints: number[];
  /** Arrow tip as a short end segment for Konva `Arrow`, once it has started. */
  xTip: { points: number[]; opacity: number } | null;
  yTip: { points: number[]; opacity: number } | null;
  /** Ticks drawn so far, each partially drawn from its Manim start point. */
  xTickSegments: number[][];
  yTickSegments: number[][];
  /** Text boxes: x numbers and the x label are centered in `width`, y ones right-aligned. */
  xNumberLabels: AxesPreviewText[];
  yNumberLabels: AxesPreviewText[];
  xAxisLabel: AxesPreviewText | null;
  yAxisLabel: AxesPreviewText | null;
}

export interface AxesPreviewText {
  key: string;
  text: string;
  x: number;
  y: number;
  width: number;
  opacity: number;
}

function resolveAxesTipSizeScene(axes: AxesItem): {
  h: number;
  w: number;
  explicitH: boolean;
  explicitW: boolean;
} {
  const rawH =
    typeof axes.tipHeight === 'number' &&
    Number.isFinite(axes.tipHeight) &&
    axes.tipHeight > 0
      ? axes.tipHeight
      : undefined;
  const legacyH =
    typeof axes.tipLength === 'number' &&
    Number.isFinite(axes.tipLength) &&
    axes.tipLength > 0
      ? axes.tipLength
      : undefined;
  const h = rawH ?? legacyH ?? DEFAULT_TIP_HEIGHT_SCENE;
  const explicitH = rawH !== undefined || legacyH !== undefined;

  const rawW =
    typeof axes.tipWidth === 'number' &&
    Number.isFinite(axes.tipWidth) &&
    axes.tipWidth > 0
      ? axes.tipWidth
      : undefined;
  const w = rawW ?? h;
  const explicitW = rawW !== undefined;
  return { h, w, explicitH, explicitW };
}

/** Tip geometry for Konva `Arrow` — aligned with Manim `tip_height` / `tip_width`. */
export function axesArrowPointerMetrics(args: {
  axes: AxesItem;
  axisStrokeWidth: number;
  pxPerUnitX: number;
  pxPerUnitY: number;
}): {
  xPointerLength: number;
  xPointerWidth: number;
  yPointerLength: number;
  yPointerWidth: number;
} {
  const { axes, axisStrokeWidth, pxPerUnitX, pxPerUnitY } = args;
  const { h, w, explicitH, explicitW } = resolveAxesTipSizeScene(axes);

  const xLenRaw = h * pxPerUnitX;
  const yLenRaw = h * pxPerUnitY;
  const xWidRaw = w * pxPerUnitX;
  const yWidRaw = w * pxPerUnitY;

  const xLen = explicitH
    ? Math.max(1, xLenRaw)
    : Math.max(10, xLenRaw + axisStrokeWidth * 2);
  const yLen = explicitH
    ? Math.max(1, yLenRaw)
    : Math.max(10, yLenRaw + axisStrokeWidth * 2);

  const xWid = explicitW
    ? Math.max(1, xWidRaw)
    : Math.max(xLen * 1.22, axisStrokeWidth * 5);
  const yWid = explicitW
    ? Math.max(1, yWidRaw)
    : Math.max(yLen * 1.22, axisStrokeWidth * 5);

  return {
    xPointerLength: xLen,
    xPointerWidth: xWid,
    yPointerLength: yLen,
    yPointerWidth: yWid,
  };
}

/** Manim tick half-length in local px. */
function tickHalfPx(axes: AxesItem, scenePxPerUnit: number): number {
  const size =
    typeof axes.tickLength === 'number' && Number.isFinite(axes.tickLength)
      ? axes.tickLength
      : DEFAULT_TICK_SIZE_SCENE;
  return Math.max(0.5, size * scenePxPerUnit);
}

/** Manim `stroke_width` as canvas px. */
function manimStrokePx(width: number | undefined, scenePxPerUnit: number): number {
  const w = typeof width === 'number' && Number.isFinite(width) ? width : DEFAULT_AXIS_STROKE_WIDTH;
  return Math.max(0.5, w * MANIM_STROKE_UNITS_PER_WIDTH * scenePxPerUnit);
}

/**
 * Full tick segments in local px, ordered and oriented like Manim's: x ticks left to right,
 * each drawn bottom to top; y ticks bottom to top, each drawn right to left. Tick values follow
 * Manim (`manimAxisTickValues`): no origin tick, no tick under a tip.
 */
export function buildAxesTickSegments(params: {
  axes: AxesItem;
  axW: number;
  axH: number;
  ox: number;
  oy: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  scenePxPerUnit: number;
}): { xTicks: number[][]; yTicks: number[][]; xTickValues: number[]; yTickValues: number[] } {
  const { axes, axW, axH, ox, oy, xMin, xMax, yMin, yMax, scenePxPerUnit } = params;
  const yLine = -axH / 2 + oy;
  const xLine = -axW / 2 + ox;
  const half = tickHalfPx(axes, scenePxPerUnit);
  const plan = axesCreatePlan(axes);

  const xTickValues = plan.xTicks;
  const xTicks = xTickValues.map((gx) => {
    const lx = -axW / 2 + ((gx - xMin) / (xMax - xMin)) * axW;
    return [lx, yLine + half, lx, yLine - half];
  });
  const yTickValues = plan.yTicks;
  const yTicks = yTickValues.map((gy) => {
    const ly = -axH / 2 + (1 - (gy - yMin) / (yMax - yMin)) * axH;
    return [xLine + half, ly, xLine - half, ly];
  });
  return { xTicks, yTicks, xTickValues, yTickValues };
}

/** First `fraction` of a straight segment [x0, y0, x1, y1]. */
function partialSegment(seg: readonly number[], fraction: number): number[] {
  const [x0, y0, x1, y1] = seg as [number, number, number, number];
  return [x0, y0, x0 + (x1 - x0) * fraction, y0 + (y1 - y0) * fraction];
}

/**
 * Canvas state of an axes at `time`, drawn the way the exported `Create(axes)` draws it
 * (`axesCreatePlan`): pieces appear one after another, each with Manim `smooth` easing,
 * over the axes' animation window (`clipAnimationWindow`, audio-aware).
 */
export function buildAxesCreatePreviewSpec(args: {
  axes: AxesItem;
  time: number;
  itemsMap: Map<ItemId, SceneItem>;
  audioItems?: AudioTrackItem[];
  axW: number;
  axH: number;
  ox: number;
  oy: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  scenePxPerUnit: number;
  /** Defaults to `scenePxPerUnit` when omitted (e.g. tests). */
  pxPerUnitX?: number;
  pxPerUnitY?: number;
}): AxesCreatePreviewSpec {
  const {
    axes,
    time,
    itemsMap,
    audioItems,
    axW,
    axH,
    ox,
    oy,
    xMin,
    xMax,
    yMin,
    yMax,
    scenePxPerUnit,
    pxPerUnitX: pxUxIn,
    pxPerUnitY: pxUyIn,
  } = args;
  const pxPerUnitX = pxUxIn ?? scenePxPerUnit;
  const pxPerUnitY = pxUyIn ?? scenePxPerUnit;

  const progress = axesCreateAlpha(axes, time, itemsMap, audioItems);
  const plan = axesCreatePlan(axes);
  const partProgress = (role: AxesCreatePartRole, index = 0): number => {
    const part = plan.parts.find((p) => p.role === role && p.index === index);
    return part ? axesCreatePartProgress(part, plan.members, progress) : 0;
  };

  // Manim defaults: white axes, ticks matching the axis style (`match_style`), white text.
  const axisStrokeColor =
    typeof axes.axisColor === 'string' && axes.axisColor.trim()
      ? axes.axisColor.trim()
      : '#FFFFFF';
  const axisStrokeWidth = manimStrokePx(axes.axisStrokeWidth, scenePxPerUnit);
  const tickStrokeColor =
    typeof axes.tickColor === 'string' && axes.tickColor.trim()
      ? axes.tickColor.trim()
      : axisStrokeColor;
  const tickStrokeWidth = manimStrokePx(axes.tickStrokeWidth ?? axes.axisStrokeWidth, scenePxPerUnit);
  const numberColor =
    typeof axes.numberColor === 'string' && axes.numberColor.trim()
      ? axes.numberColor.trim()
      : '#FFFFFF';
  const numberManimSize =
    typeof axes.numberFontSize === 'number' && Number.isFinite(axes.numberFontSize)
      ? axes.numberFontSize
      : 36;
  const numberFontSize = Math.max(4, (numberManimSize / 36) * NUMBER_EM_SCENE_AT_36 * scenePxPerUnit);
  const axisLabelFontSize = Math.max(4, LABEL_EM_SCENE * scenePxPerUnit);
  const axisLabelColor = '#FFFFFF';

  const pointers = axesArrowPointerMetrics({
    axes,
    axisStrokeWidth,
    pxPerUnitX,
    pxPerUnitY,
  });

  const yLine = -axH / 2 + oy;
  const xLine = -axW / 2 + ox;
  const xEnd = axW / 2;
  const yEnd = -axH / 2;
  const tip = !!axes.includeTip;

  // Axis lines stop at the tip base; the tip is its own piece.
  const xLineSeg = [-axW / 2, yLine, xEnd - (tip ? pointers.xPointerLength : 0), yLine];
  const yLineSeg = [xLine, axH / 2, xLine, yEnd + (tip ? pointers.yPointerLength : 0)];
  const xLineP = partProgress('xLine');
  const yLineP = partProgress('yLine');
  const xAxisPoints = xLineP > 0 ? partialSegment(xLineSeg, xLineP) : [];
  const yAxisPoints = yLineP > 0 ? partialSegment(yLineSeg, yLineP) : [];
  const xTipP = tip ? partProgress('xTip') : 0;
  const yTipP = tip ? partProgress('yTip') : 0;
  const xTip = xTipP > 0 ? { points: [xEnd - 1, yLine, xEnd, yLine], opacity: xTipP } : null;
  const yTip = yTipP > 0 ? { points: [xLine, yEnd + 1, xLine, yEnd], opacity: yTipP } : null;

  const { xTicks, yTicks } = buildAxesTickSegments({
    axes,
    axW,
    axH,
    ox,
    oy,
    xMin,
    xMax,
    yMin,
    yMax,
    scenePxPerUnit,
  });
  const drawnTicks = (ticks: number[][], role: 'xTick' | 'yTick') =>
    ticks.flatMap((seg, i) => {
      const p = partProgress(role, i);
      return p > 0 ? [partialSegment(seg, p)] : [];
    });
  const xTickSegments = drawnTicks(xTicks, 'xTick');
  const yTickSegments = drawnTicks(yTicks, 'yTick');

  // Numbers: Manim puts them 0.25 below / left of the axis (`line_to_number_buff`).
  const boxW = numberFontSize * 6;
  const digitHalf = (numberFontSize * 0.257) / NUMBER_EM_SCENE_AT_36 / 2;
  const xNumberLabels = plan.xNumbers.flatMap((text, i) => {
    const opacity = partProgress('xNumber', i);
    const seg = xTicks[i];
    if (!(opacity > 0) || !seg) return [];
    const cy = yLine + NUMBER_BUFF_SCENE * pxPerUnitY + digitHalf;
    return [{ key: `xn-${i}`, text, x: seg[0]! - boxW / 2, y: cy - numberFontSize / 2, width: boxW, opacity }];
  });
  const yNumberLabels = plan.yNumbers.flatMap((text, i) => {
    const opacity = partProgress('yNumber', i);
    const seg = yTicks[i];
    if (!(opacity > 0) || !seg) return [];
    const right = xLine - NUMBER_BUFF_SCENE * pxPerUnitX;
    return [{ key: `yn-${i}`, text, x: right - boxW, y: seg[1]! - numberFontSize / 2, width: boxW, opacity }];
  });

  // Labels as export places them: x below the x-axis end, y left of the y-axis end.
  const labelBoxW = axisLabelFontSize * 12;
  const xLabelP = partProgress('xLabel');
  const yLabelP = partProgress('yLabel');
  const xAxisLabel =
    plan.xLabel && xLabelP > 0
      ? {
          key: 'xl',
          text: plan.xLabel,
          x: xEnd - labelBoxW / 2,
          y: yLine + LABEL_BUFF_SCENE * pxPerUnitY - axisLabelFontSize * 0.33,
          width: labelBoxW,
          opacity: xLabelP,
        }
      : null;
  const yAxisLabel =
    plan.yLabel && yLabelP > 0
      ? {
          key: 'yl',
          text: plan.yLabel,
          x: xLine - LABEL_BUFF_SCENE * pxPerUnitX - labelBoxW,
          y: yEnd - axisLabelFontSize / 2,
          width: labelBoxW,
          opacity: yLabelP,
        }
      : null;

  return {
    progress,
    axisStrokeColor,
    axisStrokeWidth,
    tickStrokeColor,
    tickStrokeWidth,
    numberColor,
    numberFontSize,
    xPointerLength: pointers.xPointerLength,
    xPointerWidth: pointers.xPointerWidth,
    yPointerLength: pointers.yPointerLength,
    yPointerWidth: pointers.yPointerWidth,
    axisLabelFontSize,
    axisLabelColor,
    xAxisPoints,
    yAxisPoints,
    xTip,
    yTip,
    xTickSegments,
    yTickSegments,
    xNumberLabels,
    yNumberLabels,
    xAxisLabel,
    yAxisLabel,
  };
}

export interface PlotCreatePreviewSpec {
  progress: number;
  points: number[];
  revealHead: { x: number; y: number } | null;
}

export interface GraphDotPreviewSpec {
  x: number;
  y: number;
  radius: number;
  label: GraphTextAnnotationSpec | null;
  coordinates: string | null;
  coordinateLabel: GraphTextAnnotationSpec | null;
  projectionGuides: number[][];
}

export function buildGraphDotPreviewSpec(args: {
  dot: GraphDot;
  axW: number;
  axH: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  scenePxPerUnit: number;
  axes?: AxesItem;
  graphToLocal?: (gx: number, gy: number) => { x: number; y: number };
  /** Plot slope at the dot for a `{slope}` live value. */
  slope?: number | null;
}): GraphDotPreviewSpec {
  const { dot, axW, axH, xMin, xMax, yMin, yMax, scenePxPerUnit, axes, graphToLocal } = args;
  const xSpan = xMax - xMin;
  const ySpan = yMax - yMin;
  const local = graphToLocal?.(dot.dx, dot.dy);
  const x = local?.x ?? (xSpan > 0 ? -axW / 2 + ((dot.dx - xMin) / xSpan) * axW : 0);
  const y = local?.y ?? (ySpan > 0 ? -axH / 2 + (1 - (dot.dy - yMin) / ySpan) * axH : 0);
  const radius =
    Number.isFinite(dot.radius) && dot.radius > 0
      ? Math.max(1, dot.radius * scenePxPerUnit)
      : Math.max(1, 0.08 * scenePxPerUnit);
  const annotations = buildGraphAnnotationLayout({ dot, point: { x, y }, coordinate: { x: dot.dx, y: dot.dy }, radiusPx: radius, pxPerUnit: scenePxPerUnit, slope: args.slope });
  return {
    x,
    y,
    radius,
    label: annotations.fixedLabel,
    coordinates: annotations.coordinateText,
    coordinateLabel: annotations.coordinates,
    projectionGuides: guideSegments(),
  };

  function guideSegments(): number[][] {
    if (!dot.showProjectionGuides || !axes) return [];
    const guides = graphProjectionGuides({ x: dot.dx, y: dot.dy }, axes);
    const toLocal = (gx: number, gy: number) => {
      if (graphToLocal) {
        const p = graphToLocal(gx, gy);
        return [p.x, p.y];
      }
      return [-axW / 2 + ((gx - xMin) / (xMax - xMin)) * axW, -axH / 2 + (1 - (gy - yMin) / (yMax - yMin)) * axH];
    };
    return [[...toLocal(guides.vertical.x1, guides.vertical.y1), ...toLocal(guides.vertical.x2, guides.vertical.y2)], [...toLocal(guides.horizontal.x1, guides.horizontal.y1), ...toLocal(guides.horizontal.x2, guides.horizontal.y2)]];
  }
}

export function buildPlotCreatePreviewSpec(args: {
  plot: GraphPlotItem;
  time: number;
  itemsMap: Map<ItemId, SceneItem>;
  fullPoints: number[];
  /** Narration: a plot bound to it is created over the narration's run time, as in export. */
  audioItems?: AudioTrackItem[];
}): PlotCreatePreviewSpec {
  const { plot, time, itemsMap, fullPoints, audioItems } = args;
  // Manim's Create over the export run time, eased with Manim `smooth`.
  const progress = manimSmooth(clipWindowAlpha(plot, time, itemsMap, audioItems));
  const t0 = effectiveStart(plot, itemsMap);

  if (time < t0 || fullPoints.length < 4) {
    return { progress, points: [], revealHead: null };
  }

  const points =
    progress >= 1 ? fullPoints : clipPolylineByProgress(fullPoints, progress);

  const revealHead =
    progress > 0 && progress < 1 ? polyEndpoint(points) : null;

  return { progress, points, revealHead };
}

export function buildCurveCreatePreviewSpec(args: {
  curveItem: GraphCurveItem;
  time: number;
  itemsMap: Map<ItemId, SceneItem>;
  fullPoints: number[];
  /** Narration: a plot bound to it is created over the narration's run time, as in export. */
  audioItems?: AudioTrackItem[];
}): PlotCreatePreviewSpec {
  const { curveItem, time, itemsMap, fullPoints, audioItems } = args;
  // Manim's Create over the export run time, eased with Manim `smooth`.
  const progress = manimSmooth(clipWindowAlpha(curveItem, time, itemsMap, audioItems));
  const t0 = effectiveStart(curveItem, itemsMap);

  if (time < t0 || fullPoints.length < 4) {
    return { progress, points: [], revealHead: null };
  }

  const points =
    progress >= 1 ? fullPoints : clipPolylineByProgress(fullPoints, progress);

  const revealHead =
    progress > 0 && progress < 1 ? polyEndpoint(points) : null;

  return { progress, points, revealHead };
}
