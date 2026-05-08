import type {
  AxesItem,
  GraphDot,
  GraphPlotItem,
  ItemId,
  ManimDirection,
  SceneItem,
} from '@/types/scene';
import { clipPolylineByProgress, createProgress } from '@/lib/createPlaybackPreview';
import { effectiveStart } from '@/lib/time';

/** Denser polylines than a 2-point segment so Create previews read as drawing. */
export const AXIS_LINE_DENSITY = 48;

/** X axis line fills [0, pXEnd), Y axis fills [pXEnd, pYEnd), ticks fade in [tickStart, 1]. */
export const AXES_PREVIEW_PHASE_X_END = 0.4;
export const AXES_PREVIEW_PHASE_Y_END = 0.8;
export const AXES_PREVIEW_TICK_PHASE_START = 0.8;

/** Default tick half-length in local px (Manim-like ~0.08 scene units at ~100px/unit). */
const DEFAULT_TICK_HALF_PX = 8;

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

function phase01(progress: number, segmentStart: number, segmentEnd: number): number {
  if (!(segmentEnd > segmentStart)) return progress >= segmentEnd ? 1 : 0;
  if (progress <= segmentStart) return 0;
  if (progress >= segmentEnd) return 1;
  return (progress - segmentStart) / (segmentEnd - segmentStart);
}

/** Generate polyline for horizontal axis across the plotting box bottom (local Konva coords). */
export function densifiedHorizontalAxisPoints(
  axW: number,
  axH: number,
  oy: number,
  steps = AXIS_LINE_DENSITY,
): number[] {
  const yLine = -axH / 2 + oy;
  const pts: number[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = -axW / 2 + t * axW;
    pts.push(x, yLine);
  }
  return pts;
}

/** Generate polyline for vertical axis across the plotting box left (local Konva coords). */
export function densifiedVerticalAxisPoints(
  axW: number,
  axH: number,
  ox: number,
  steps = AXIS_LINE_DENSITY,
): number[] {
  const xLine = -axW / 2 + ox;
  const pts: number[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const y = axH / 2 - t * axH;
    pts.push(xLine, y);
  }
  return pts;
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
  xAxisPoints: number[];
  yAxisPoints: number[];
  xTickSegments: number[][];
  yTickSegments: number[][];
  xNumberLabels: { key: string; text: string; x: number; y: number }[];
  yNumberLabels: { key: string; text: string; x: number; y: number }[];
  tickOpacity: number;
  xLabelOpacity: number;
  yLabelOpacity: number;
  xAxisLabel: { text: string; x: number; y: number } | null;
  yAxisLabel: { text: string; x: number; y: number } | null;
  revealHead: { x: number; y: number } | null;
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

/** Integer ticks from range triple (min,max,step) clamped inside [vmin,vmax]. */
function graphTicksInRange(range: readonly [number, number, number]): number[] {
  const [vmin, vmax, rawStep] = range;
  if (!(vmax > vmin) || !(rawStep > 0)) return [];
  const step = rawStep;
  const out: number[] = [];
  const start = Math.ceil(vmin / step - 1e-9) * step;
  for (let v = start; v <= vmax + step * 1e-9; v += step) {
    if (v < vmin - 1e-9 || v > vmax + 1e-9) continue;
    const rounded = Number.isFinite(v) ? Number(v.toFixed(10)) : v;
    out.push(rounded);
    if (out.length > 200) break;
  }
  return out;
}

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
  const yAxis = -axH / 2 + oy;
  const xAxisLine = -axW / 2 + ox;
  const tickLen =
    typeof axes.tickLength === 'number' && Number.isFinite(axes.tickLength)
      ? Math.max(1, axes.tickLength * scenePxPerUnit)
      : Math.max(DEFAULT_TICK_HALF_PX, scenePxPerUnit * 0.085);

  const xTicksVals = graphTicksInRange(axes.xRange);
  const yTicksVals = graphTicksInRange(axes.yRange);

  const xTicks: number[][] = [];
  const xTickValues: number[] = [];
  for (const gx of xTicksVals) {
    if (gx < xMin - 1e-9 || gx > xMax + 1e-9) continue;
    const t = (gx - xMin) / (xMax - xMin);
    const lx = -axW / 2 + t * axW;
    xTicks.push([lx, yAxis - tickLen / 2, lx, yAxis + tickLen / 2]);
    xTickValues.push(gx);
  }

  const yTicks: number[][] = [];
  const yTickValues: number[] = [];
  for (const gy of yTicksVals) {
    if (gy < yMin - 1e-9 || gy > yMax + 1e-9) continue;
    const t = (gy - yMin) / (yMax - yMin);
    const ly = -axH / 2 + (1 - t) * axH;
    yTicks.push([xAxisLine - tickLen / 2, ly, xAxisLine + tickLen / 2, ly]);
    yTickValues.push(gy);
  }

  return { xTicks, yTicks, xTickValues, yTickValues };
}

export function buildAxesCreatePreviewSpec(args: {
  axes: AxesItem;
  time: number;
  itemsMap: Map<ItemId, SceneItem>;
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

  const progress = createProgress(axes, time, itemsMap);
  const t0 = effectiveStart(axes, itemsMap);

  const axisStrokeColor =
    typeof axes.axisColor === 'string' && axes.axisColor.trim()
      ? axes.axisColor.trim()
      : '#94a3b8';
  const axisStrokeWidth =
    typeof axes.axisStrokeWidth === 'number' &&
    Number.isFinite(axes.axisStrokeWidth)
      ? Math.max(0.5, axes.axisStrokeWidth)
      : 1;
  const tickStrokeColor =
    typeof axes.tickColor === 'string' && axes.tickColor.trim()
      ? axes.tickColor.trim()
      : axisStrokeColor;
  const tickStrokeWidth =
    typeof axes.tickStrokeWidth === 'number' &&
    Number.isFinite(axes.tickStrokeWidth)
      ? Math.max(0.5, axes.tickStrokeWidth)
      : Math.max(0.5, axisStrokeWidth * 0.85);
  const numberColor =
    typeof axes.numberColor === 'string' && axes.numberColor.trim()
      ? axes.numberColor.trim()
      : '#cbd5e1';
  const numberFontSize =
    typeof axes.numberFontSize === 'number' && Number.isFinite(axes.numberFontSize)
      ? Math.max(6, axes.numberFontSize * 0.45)
      : 10;
  const axisLabelFontSize = Math.max(8, numberFontSize * 1.12);
  const axisLabelColor = axisStrokeColor;

  const pointers = axesArrowPointerMetrics({
    axes,
    axisStrokeWidth,
    pxPerUnitX,
    pxPerUnitY,
  });

  const tickLenPx =
    typeof axes.tickLength === 'number' && Number.isFinite(axes.tickLength)
      ? Math.max(1, axes.tickLength * scenePxPerUnit)
      : Math.max(DEFAULT_TICK_HALF_PX, scenePxPerUnit * 0.085);

  const fullX = densifiedHorizontalAxisPoints(axW, axH, oy);
  const fullY = densifiedVerticalAxisPoints(axW, axH, ox);

  const xPhase = phase01(progress, 0, AXES_PREVIEW_PHASE_X_END);
  const yPhase = phase01(progress, AXES_PREVIEW_PHASE_X_END, AXES_PREVIEW_PHASE_Y_END);
  const tickPhase = phase01(progress, AXES_PREVIEW_TICK_PHASE_START, 1);

  const xAxisPoints =
    time < t0 ? [] : clipPolylineByProgress(fullX, xPhase);
  const yAxisPoints =
    time < t0 ? [] : clipPolylineByProgress(fullY, yPhase);

  const { xTicks, yTicks, xTickValues, yTickValues } = buildAxesTickSegments({
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

  /** Stronger ticks when Numbers is on — still show faint ticks otherwise for motion */
  const tickBaseOpacity = axes.includeNumbers ? 0.95 : 0.42;
  const tickOpacity =
    time < t0 ? 0 : Math.max(0, Math.min(1, tickPhase * tickBaseOpacity));

  const labOpacity =
    time < t0 ? 0 : Math.max(0, Math.min(1, tickPhase));
  const numBelowAxis = tickLenPx * 0.55 + numberFontSize * 0.62;
  const numLeftPad = tickLenPx * 0.55 + numberFontSize * 1.05;

  const xNumberLabels =
    axes.includeNumbers && tickOpacity > 0
      ? xTicks.map((seg, i) => ({
          key: `xn-${i}`,
          text: String(xTickValues[i] ?? ''),
          x: seg[0]!,
          y: Math.max(seg[1]!, seg[3]!) + numBelowAxis,
        }))
      : [];
  const yNumberLabels =
    axes.includeNumbers && tickOpacity > 0
      ? yTicks.map((seg, i) => ({
          key: `yn-${i}`,
          text: String(yTickValues[i] ?? ''),
          x: Math.min(seg[0]!, seg[2]!) - numLeftPad,
          y: seg[1]! - numberFontSize * 0.5,
        }))
      : [];

  const yLine = -axH / 2 + oy;
  const xAxisLine = -axW / 2 + ox;
  const xLabRaw = typeof axes.xLabel === 'string' ? axes.xLabel.trim() : '';
  const yLabRaw = typeof axes.yLabel === 'string' ? axes.yLabel.trim() : '';
  const xAxisLabel =
    xLabRaw && labOpacity > 0
      ? {
          text: xLabRaw,
          x: axW / 2 - axisLabelFontSize * 0.35,
          y: yLine + tickLenPx * 0.5 + axisLabelFontSize * 0.95,
        }
      : null;
  const yAxisLabel =
    yLabRaw && labOpacity > 0
      ? {
          text: yLabRaw,
          x: xAxisLine - tickLenPx * 0.5 - axisLabelFontSize * 0.6 - yLabRaw.length * axisLabelFontSize * 0.32,
          y: -axH / 2 + axisLabelFontSize * 0.35,
        }
      : null;

  let revealHead: { x: number; y: number } | null = null;
  if (time >= t0 && progress > 0 && progress < 1) {
    if (xPhase > 0 && xPhase < 1) {
      revealHead = polyEndpoint(xAxisPoints);
    } else if (yPhase > 0 && yPhase < 1) {
      revealHead = polyEndpoint(yAxisPoints);
    }
  }

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
    xTickSegments: xTicks,
    yTickSegments: yTicks,
    xNumberLabels,
    yNumberLabels,
    tickOpacity,
    xLabelOpacity: labOpacity,
    yLabelOpacity: labOpacity,
    xAxisLabel,
    yAxisLabel,
    revealHead,
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
  label: {
    text: string;
    x: number;
    y: number;
    fontSize: number;
    fill: string;
  } | null;
}

function directionVector(dir: ManimDirection): { x: number; y: number } {
  switch (dir) {
    case 'UP':
      return { x: 0, y: -1 };
    case 'DOWN':
      return { x: 0, y: 1 };
    case 'LEFT':
      return { x: -1, y: 0 };
    case 'RIGHT':
      return { x: 1, y: 0 };
    case 'UL':
      return { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };
    case 'UR':
      return { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
    case 'DL':
      return { x: -Math.SQRT1_2, y: Math.SQRT1_2 };
    case 'DR':
      return { x: Math.SQRT1_2, y: Math.SQRT1_2 };
    default:
      return { x: 0, y: -1 };
  }
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
}): GraphDotPreviewSpec {
  const { dot, axW, axH, xMin, xMax, yMin, yMax, scenePxPerUnit } = args;
  const xSpan = xMax - xMin;
  const ySpan = yMax - yMin;
  const x = xSpan > 0 ? -axW / 2 + ((dot.dx - xMin) / xSpan) * axW : 0;
  const y = ySpan > 0 ? -axH / 2 + (1 - (dot.dy - yMin) / ySpan) * axH : 0;
  const radius =
    Number.isFinite(dot.radius) && dot.radius > 0
      ? Math.max(1, dot.radius * scenePxPerUnit)
      : Math.max(1, 0.08 * scenePxPerUnit);
  const text = dot.label.trim();
  if (!text) {
    return { x, y, radius, label: null };
  }

  const fontSize = 10;
  const textWidth = Math.max(fontSize * 0.6, text.length * fontSize * 0.55);
  const textHeight = fontSize;
  const dir = directionVector(dot.labelDir);
  const buff = 0.15 * scenePxPerUnit;
  const gap = radius + buff;
  const cx = x + dir.x * gap;
  const cy = y + dir.y * gap;

  return {
    x,
    y,
    radius,
    label: {
      text,
      x: cx - textWidth / 2,
      y: cy - textHeight / 2,
      fontSize,
      fill: '#ffffff',
    },
  };
}

export function buildPlotCreatePreviewSpec(args: {
  plot: GraphPlotItem;
  time: number;
  itemsMap: Map<ItemId, SceneItem>;
  fullPoints: number[];
}): PlotCreatePreviewSpec {
  const { plot, time, itemsMap, fullPoints } = args;
  const progress = createProgress(plot, time, itemsMap);
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
