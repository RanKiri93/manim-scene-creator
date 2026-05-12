export type ItemId = string;

// ── Temporal core ──

export interface TimeSpan {
  startTime: number;
  duration: number;
}

export interface SpatialTransform {
  x: number;
  y: number;
  scale: number;
}

// ── Positioning pipeline ──

export type ManimDirection =
  | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'
  | 'UL' | 'UR' | 'DL' | 'DR';

export interface PosStepAbsolute { kind: 'absolute' }

/** Bbox of one `HebrewMathLine` submobject in the line's local frame (line centered at origin). */
export interface SegmentLocalBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Math/text flag in the same visual submobject order as this box, when supplied by measure server. */
  isMath?: boolean | null;
}

/** Nested Manim submobject inside a math segment; `childIndex` matches export `line[segmentIndex][childIndex]`. */
export interface MathChildLocalBox {
  segmentIndex: number;
  childIndex: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** `null` on `bounds` = legacy preview (tight ink size, mobject center — matches older projects). */
export type NextToBoundsMode = 'mobject' | 'ink';

export interface PosStepNextTo {
  kind: 'next_to';
  refKind: 'line' | 'axes' | 'shape';
  refId: ItemId | null;
  dir: ManimDirection;
  buff: number;
  /** `null` = Manim `ORIGIN` (center along perpendicular axes). */
  alignedEdge: ManimDirection | null;
  /** Text line target: `refVar[i]` in export / segment bbox for preview. */
  refSegmentIndex: number | null;
  /** Text line self: Manim `submobject_to_align=var[i]`. */
  selfSegmentIndex: number | null;
  /** Text line geometry for alignment; `null` = legacy hybrid. */
  bounds: NextToBoundsMode | null;
}
export interface PosStepToEdge {
  kind: 'to_edge';
  edge: ManimDirection;
  buff: number;
  /** Text line geometry for frame-edge alignment; `null` = legacy hybrid. */
  bounds?: NextToBoundsMode | null;
}
export interface PosStepShift  { kind: 'shift'; dx: number; dy: number }
export interface PosStepSetX   { kind: 'set_x'; x: number }
export interface PosStepSetY   { kind: 'set_y'; y: number }

export type PosStep =
  | PosStepAbsolute
  | PosStepNextTo
  | PosStepToEdge
  | PosStepShift
  | PosStepSetX
  | PosStepSetY;

// ── Segment styling ──

export interface SegmentStyle {
  text: string;
  isMath: boolean;
  color: string;
  bold: boolean;
  italic: boolean;
  /** Optional pause (seconds) after this segment in timeline + export; omitted or ≤0 = none. */
  waitAfterSec?: number;
  /**
   * Optional seconds for this segment's Write/FadeIn run_time; omitted = equal share of line `duration`.
   * Sum of resolved per-segment anim times should match the line's animation-only `duration`.
   */
  animSec?: number;
}

/** How a text line is introduced or transitioned in the scene. */
export type AnimStyle =
  | 'write'
  | 'fade_in'
  | 'transform';

export type UnmappedSourceBehavior = 'fade_out' | 'leave';

export type UnmappedTargetBehavior = 'fade_in' | 'write';

/**
 * Maps LaTeX segment indices on this line (target) to segments on another line (source).
 * Used when animStyle is `transform`.
 */
export interface TransformMapping {
  sourceLineId: string;
  segmentPairs: Record<number, number>;
  unmappedSourceBehavior: UnmappedSourceBehavior;
  unmappedTargetBehavior: UnmappedTargetBehavior;
}

// ── Audio timeline (TTS + Whisper word boundaries) ──

export interface WordBoundary {
  word: string;
  start: number;
  end: number;
}

export interface AudioTrackItem {
  id: string;
  text: string;
  audioUrl: string;
  /** Set when loaded from .mtproj (or when saving a bundle) so Manim export uses this path instead of parsing `audioUrl`. */
  assetRelPath?: string;
  /** Seconds relative to clip start; may be omitted if `word_boundaries` is set (e.g. raw server JSON). */
  boundaries?: WordBoundary[];
  /** Alternate key from some APIs / saved files; merged with `boundaries` in `getAudioBoundaries`. */
  word_boundaries?: WordBoundary[];
  startTime: number;
  duration: number;
}

/** Convert boundary timestamps to seconds when the server sent milliseconds. */
export function boundaryTimeToSeconds(t: number, clipDurationSec: number): number {
  if (t > Math.max(clipDurationSec * 2, 50)) {
    return t / 1000;
  }
  return t;
}

/** Resolved list: `boundaries` ?? `word_boundaries`, with times normalized to seconds. */
export function getAudioBoundaries(item: AudioTrackItem): WordBoundary[] {
  const raw = item.boundaries ?? item.word_boundaries ?? [];
  return raw.map((b) => ({
    word: b.word,
    start: boundaryTimeToSeconds(b.start, item.duration),
    end: boundaryTimeToSeconds(b.end, item.duration),
  }));
}

// ── Measurement cache ──

export interface MeasureResult {
  width: number;
  height: number;
  widthInk: number;
  heightInk: number;
  offsetInkX: number;
  offsetInkY: number;
  inkLeftX: number;
  inkRightX: number;
  inkTopY: number;
  inkBottomY: number;
  bboxLeft: number;
  bboxRight: number;
  bboxTop: number;
  bboxBottom: number;
  pngBase64: string | null;
  pngWidth: number | null;
  pngHeight: number | null;
  /** Per `HebrewMathLine` submobject (same index as export `line[i]`). */
  segmentMeasures: SegmentLocalBox[] | null;
  /** Nested boxes for math segments only (UI / preview); from measure server `math_child_boxes`. */
  mathChildMeasures: MathChildLocalBox[] | null;
}

// ── Scene items ──

/** Manim exit animation played by a separate timeline clip targeting a scene object. */
export type ExitAnimStyle =
  | 'fade_out'
  | 'uncreate'
  | 'shrink_to_center'
  | 'none';

/** One object in a multi-target exit clip; each row can use a different `animStyle`. */
export interface ExitTargetSpec {
  targetId: ItemId;
  animStyle: ExitAnimStyle;
}

interface SceneItemBase extends TimeSpan, SpatialTransform {
  id: ItemId;
  label: string;
  layer: number;
  posSteps: PosStep[];
  /**
   * When true, the object is on screen from the first frame (`t=0`): preview shows it immediately
   * and export uses `self.add(...)` instead of an intro animation. Requires `startTime === 0`.
   */
  visibleAtSceneStart?: boolean;
  /**
   * Export audio binding: `undefined`/`null` = auto (timeline overlap), explicit id = that track,
   * `AUDIO_BINDING_NONE` (`__none__`) = never bind audio for this clip.
   */
  audioTrackId?: string | null;
}

/**
 * Top-level clip: runs exit animations on all `targets` at `startTime` concurrently
 * (`AnimationGroup` in export) for `duration` seconds.
 */
export interface ExitAnimationItem {
  kind: 'exit_animation';
  id: ItemId;
  label: string;
  layer: number;
  startTime: number;
  duration: number;
  targets: ExitTargetSpec[];
}

/** Visual pulse / emphasis: scale or color, then restore. Does not remove targets. */
export type BlinkMode = 'scale' | 'color';

export interface BlinkTargetSpec {
  targetId: ItemId;
  mode: BlinkMode;
  /**
   * Peak scale factor (1 = none). Used when `mode` is `scale`.
   * Default in UI / export when omitted: 1.15.
   */
  scaleFactor?: number;
  /**
   * Highlight color (CSS hex). Used when `mode` is `color`.
   * Default when omitted: `#fbbf24`.
   */
  blinkColor?: string;
  /**
   * For `textLine` targets: subset of segment indices (same order as `line[i]` / export).
   * Omit or empty = whole line.
   */
  segmentIndices?: number[] | null;
  /**
   * Optional refinement: Manim subobjects inside math segments (`line[segmentIndex][childIndex]`).
   * When present for a math segment, that segment blinks those children instead of the whole segment.
   */
  mathSubtargets?: { segmentIndex: number; childIndices: number[] }[] | null;
}

/**
 * Timeline clip: run blink on all `targets` at `startTime` in parallel for `duration` seconds.
 */
export interface BlinkAnimationItem {
  kind: 'blink_animation';
  id: ItemId;
  label: string;
  layer: number;
  startTime: number;
  duration: number;
  /**
   * Number of up→down cycles packed into `duration` (default 1).
   * Each cycle: ramp up over half the cycle time, ramp down over the other half.
   */
  repetitions: number;
  targets: BlinkTargetSpec[];
}

/** Permanent transform played at `startTime` for `duration`; state lives on clips, not mutated target fields. */
export type TargetAnimationMode = 'scale' | 'color' | 'move' | 'path' | 'rotate';
export type TargetAnimationPathKind = 'polyline' | 'parametric';

export interface TargetAnimationParametricPath {
  jsXExpr: string;
  jsYExpr: string;
  pyXExpr: string;
  pyYExpr: string;
  tMin: number;
  tMax: number;
  samples?: number;
}

export interface TargetAnimationTargetSpec {
  targetId: ItemId;
  /**
   * Multiplier vs current on-screen scale at clip start (`mode === 'scale'`).
   */
  scaleFactor?: number;
  /** New stroke / line color (`mode === 'color'`); text uses segment refinement like blink. */
  color?: string;
  /** Cartesian shift (`mode === 'move'`) — Manim RIGHT / UP convention. */
  dx?: number;
  dy?: number;
  /**
   * Polyline vertices as offsets from the object's anchor at clip start (`mode === 'path'`).
   * First vertex is usually (0,0); motion follows corners in order; final vertex is the persistent offset.
   */
  pathKind?: TargetAnimationPathKind;
  pathPoints?: ShapePoint[];
  parametricPath?: TargetAnimationParametricPath | null;
  /** Degrees CCW (`mode === 'rotate'`); allowed on shape, text line, surroundingRect. */
  angleDeg?: number;
  segmentIndices?: number[] | null;
  mathSubtargets?: { segmentIndex: number; childIndices: number[] }[] | null;
}

export interface TargetAnimationItem {
  kind: 'target_animation';
  id: ItemId;
  label: string;
  layer: number;
  startTime: number;
  duration: number;
  mode: TargetAnimationMode;
  targets: TargetAnimationTargetSpec[];
}

/** Highlight box around one or more objects; optional label; remove with an exit clip targeting this id. */
export interface SurroundingRectItem {
  kind: 'surroundingRect';
  id: ItemId;
  label: string;
  layer: number;
  startTime: number;
  /**
   * `self.play` duration for Create/FadeIn; timeline clip width. The rectangle stays on screen
   * until an exit animation targets this clip (no separate hold in Manim).
   */
  runTime: number;
  /** Ordered unique ids; export uses `VGroup(...)` when length > 1. */
  targetIds: ItemId[];
  /**
   * When there is exactly one target and it is a `textLine`, optional 0-based segment indices
   * on the exported `HebrewMathLine` (omit or empty = surround the whole line).
   */
  segmentIndices?: number[] | null;
  buff: number;
  color: string;
  cornerRadius: number;
  strokeWidth: number;
  labelText: string;
  labelDir: ManimDirection;
  labelFontSize: number;
  introStyle: 'create' | 'fade_in';
  /** Same semantics as {@link SceneItemBase.visibleAtSceneStart}. */
  visibleAtSceneStart?: boolean;
}

export type ShapeKind = 'circle' | 'rectangle' | 'arrow' | 'line' | 'polyline';

export interface ShapePoint {
  x: number;
  y: number;
}

export const DEFAULT_SHAPE_POLYLINE_POINTS: ShapePoint[] = [
  { x: -1, y: 0 },
  { x: 0, y: 0.75 },
  { x: 1, y: 0 },
];

/** Primitive shape: circle, rectangle, arrow, line, or polyline; positioned like other scene objects. */
export interface ShapeItem extends SceneItemBase {
  kind: 'shape';
  shapeType: ShapeKind;
  /** Degrees, CCW; applied in Manim after move_to. */
  rotationDeg: number;
  /** Circle radius (Manim units). */
  radius: number;
  /** Rectangle width / height (Manim units). */
  width: number;
  height: number;
  /** Arrow or line: vector from tail to tip in local space before rotation/scale. */
  endX: number;
  endY: number;
  /** Polyline: ordered local points relative to the shape anchor. */
  points: ShapePoint[];
  /** Polyline: arrowhead at the first vertex. */
  tailArrow: boolean;
  /** Polyline: arrowhead at the last vertex. */
  headArrow: boolean;
  strokeColor: string;
  strokeWidth: number;
  /** Fill color; null = no fill (stroke only). */
  fillColor: string | null;
  fillOpacity: number;
  introStyle: 'create' | 'fade_in';
}

export interface TextLineItem extends SceneItemBase {
  kind: 'textLine';
  raw: string;
  font: string;
  fontSize: number;
  animStyle?: AnimStyle;
  /** When animStyle is `transform`, maps segments from `sourceLineId` into this line. */
  transformConfig?: TransformMapping | null;
  segments: SegmentStyle[];
  measure: MeasureResult | null;
  measureError: string | null;
  previewDataUrl: string | null;
  /** Per-submobject boxes from measure server (same index as exported `line[i]`). */
  segmentMeasures: SegmentLocalBox[] | null;
  /** Nested math-segment boxes from measure server (same indices as export `line[s][c]`). */
  mathChildMeasures: MathChildLocalBox[] | null;
}

export interface GraphFunction {
  id: ItemId;
  jsExpr: string;
  pyExpr: string;
  color: string;
  label: string;
}

export interface GraphDot {
  id: ItemId;
  dx: number;
  dy: number;
  color: string;
  radius: number;
  label: string;
  labelDir: ManimDirection;
}

/** Seed (x0, y0) for ODE streamline γ′ = F(γ) in graph coordinates. */
export interface GraphStreamPoint {
  id: ItemId;
  x: number;
  y: number;
}

export type GraphFieldMode = 'none' | 'vector' | 'slope';

export type GraphFieldColormap = 'viridis' | 'plasma' | 'inferno' | 'magma';

/** Manim axis `tip_shape` class passed through `axis_config` (omit or `default` = Manim default). */
export type AxesTipShape =
  | 'default'
  | 'ArrowTriangleTip'
  | 'StealthTip'
  | 'ArrowSquareTip';

/** Manim ink bbox for a rasterized axes preview (measure server `/api/preview_axes`). */
export interface AxisPreviewBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  offsetInkX: number;
  offsetInkY: number;
}

/** Coordinate axes only; plots/dots/fields are separate items referencing `id` via `axesId`. */
export interface AxesItem extends SceneItemBase {
  kind: 'axes';
  xRange: [number, number, number];
  yRange: [number, number, number];
  xLabel: string;
  yLabel: string;
  includeNumbers: boolean;
  includeTip: boolean;
  /**
   * Manim scene units per graph unit along x / y (horizontal length = `(xMax-xMin)*scaleX`, etc.).
   * Legacy `scale` on `SceneItemBase` is kept in sync for compatibility (geometric mean of scaleX/Y).
   */
  scaleX: number;
  scaleY: number;
  /** Stroke color (`axis_config["stroke_color"]`); omit = Manim default. */
  axisColor?: string;
  /** Stroke width (`axis_config["stroke_width"]`); omit = Manim default. */
  axisStrokeWidth?: number;
  /** Tick length (`axis_config["tick_size"]`); omit = Manim default. */
  tickLength?: number;
  /** Tick stroke color, applied after axes construction; omit = axis/default color. */
  tickColor?: string;
  /** Tick stroke width, applied after axes construction; omit = axis/default stroke width. */
  tickStrokeWidth?: number;
  /** Decimal label color (`decimal_number_config["color"]`); omit = Manim default. */
  numberColor?: string;
  /** Decimal label font size (`decimal_number_config["font_size"]`); omit = Manim default. */
  numberFontSize?: number;
  tipShape?: AxesTipShape;
  /**
   * Axis arrow tip extent along the axis (Manim `NumberLine` `tip_height`).
   * Prefer this over legacy `tipLength`.
   */
  tipHeight?: number;
  /** Axis arrow tip width perpendicular to the axis (`tip_width`). */
  tipWidth?: number;
  /** Optional stroke width of the axis tip VMobject (applied after `Axes` construction). */
  tipStrokeWidth?: number;
  /** Optional tip fill opacity in `[0, 1]` (`set_fill` on the tip). */
  tipFillOpacity?: number;
  /**
   * Legacy: was emitted as `axis_config["tip_length"]` (not aligned with Manim `tip_height`).
   * Migrated to `tipHeight` in v31; omit in new data.
   */
  tipLength?: number;
  /** Client-only: data URL from measure server axes raster preview. */
  axisPreviewDataUrl?: string | null;
  /** Client-only: last preview error from measure server. */
  axisPreviewError?: string | null;
  /** Client-only: `axesPreviewVisualKey` when the preview PNG was produced. */
  axisPreviewHash?: string | null;
  /** Client-only: ink bounds in Manim units for placing the preview image. */
  axisPreviewBounds?: AxisPreviewBounds | null;
}

/** Update `scale` when editing per-axis scales (geometric mean, clamped). */
export function syncAxesLegacyScale(scaleX: number, scaleY: number): number {
  return Math.sqrt(Math.max(0.01, scaleX) * Math.max(0.01, scaleY));
}

/** One function plot on an existing axes. */
export interface GraphPlotItem extends SceneItemBase {
  kind: 'graphPlot';
  axesId: ItemId;
  fn: GraphFunction;
  /**
   * Optional interval in axes x-coordinates over which the curve is sampled.
   * `null` uses the full axes `xRange` (same as Manim default).
   */
  xDomain: [number, number] | null;
  /** Curve stroke width (exported as `plot_var.set_stroke(width=…)` after `Axes.plot`). */
  strokeWidth: number;
  /** Solid, dashed, or dotted; omit in legacy projects → solid. */
  lineStyle?: FunctionLineStyle;
}

/** Parametric curve γ(t) = (x(t), y(t)) on an existing axes (graph coordinates). */
export interface GraphParametricCurve {
  id: ItemId;
  jsXExpr: string;
  jsYExpr: string;
  pyXExpr: string;
  pyYExpr: string;
  color: string;
  label: string;
}

/** Parametric `(x(t), y(t))` curve on axes; sampled over `tDomain`. */
export interface GraphCurveItem extends SceneItemBase {
  kind: 'graphCurve';
  axesId: ItemId;
  curve: GraphParametricCurve;
  tDomain: [number, number];
  strokeWidth: number;
  /** Solid, dashed, or dotted; omit in legacy projects → solid. */
  lineStyle?: FunctionLineStyle;
}

/** One labeled dot on an existing axes. */
export interface GraphDotItem extends SceneItemBase {
  kind: 'graphDot';
  axesId: ItemId;
  dot: GraphDot;
}

/** 2D point in graph coordinates (axes data space). */
export interface GraphPoint2 {
  x: number;
  y: number;
}

/** Boundary curve for a graph area: existing plot clip or inline expression. */
export type GraphAreaCurveSource =
  | { sourceKind: 'plot'; plotId: ItemId }
  | { sourceKind: 'expr'; jsExpr: string; pyExpr: string };

/** Geometry + bounds for a filled region on an axes (exported after axes + plots are positioned). */
export type GraphAreaMode =
  | {
      areaKind: 'underCurve';
      xMin: number;
      xMax: number;
      curve: GraphAreaCurveSource;
      /** When `curve` is expr: also `Create` the boundary plot in the play block. */
      showBoundaryPlot: boolean;
    }
  | {
      areaKind: 'betweenCurves';
      xMin: number;
      xMax: number;
      lower: GraphAreaCurveSource;
      upper: GraphAreaCurveSource;
      /** When any side is expr: `Create` those boundary plots in the play block. */
      showBoundaryPlot: boolean;
    }
  | {
      areaKind: 'parallelogramFour';
      corners: [GraphPoint2, GraphPoint2, GraphPoint2, GraphPoint2];
    }
  | {
      areaKind: 'parallelogramVec';
      ox: number;
      oy: number;
      ux: number;
      uy: number;
      vx: number;
      vy: number;
    }
  | {
      areaKind: 'disk';
      cx: number;
      cy: number;
      /** Radius in graph x-units (horizontal axis scale → scene units; vertical via separate sample). */
      radius: number;
    };

/** Filled region on an axes: under/between curves, parallelogram, or ellipse from graph disk. */
export interface GraphAreaItem extends SceneItemBase {
  kind: 'graphArea';
  axesId: ItemId;
  mode: GraphAreaMode;
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  /** 0 = no stroke (polygon / ellipse only; `get_area` uses fill only). */
  strokeWidth: number;
}

// ── Function series (family of curves f(n, x)) ──

/** Playback mode for a function series animation. */
export type FunctionSeriesMode = 'accumulation' | 'replacement';

/**
 * Geometry mode: each curve is either the individual term f(n, x) or the partial sum
 * S_k(x) = Σ_{n=nMin}^{k} f(n, x). Optional on disk: legacy scenes load as 'individual'.
 */
export type FunctionSeriesDisplayMode = 'individual' | 'partialSum';

/** Line-style for a rendered curve in a function series. */
export type FunctionLineStyle = 'solid' | 'dashed' | 'dotted';

/** Per-n style / timing overrides (missing fields fall back to `defaults`). */
export interface FunctionSeriesPerN {
  color?: string;
  strokeWidth?: number;
  lineStyle?: FunctionLineStyle;
  animDuration?: number;
  waitAfter?: number;
}

/** Apply-to-all defaults for a function series (every field required). */
export interface FunctionSeriesDefaults {
  color: string;
  strokeWidth: number;
  lineStyle: FunctionLineStyle;
  animDuration: number;
  waitAfter: number;
}

/**
 * Family of curves y = f(n, x) drawn on existing axes for integer n in [nMin, nMax].
 * Playback mode determines whether curves accumulate (Create each) or replace one another
 * (Create the first, then ReplacementTransform into each next).
 *
 * `perN` is a retention dictionary keyed by the integer n (stringified) — shrinking the
 * range does NOT delete entries, so expanding later restores prior per-index styling.
 */
export interface GraphFunctionSeriesItem extends SceneItemBase {
  kind: 'graphFunctionSeries';
  axesId: ItemId;
  jsExpr: string;
  pyExpr: string;
  nMin: number;
  nMax: number;
  mode: FunctionSeriesMode;
  /**
   * When 'partialSum', each rendered curve is S_k(x) = Σ_{n=nMin}^{k} f(n, x); with
   * `mode='replacement'` this produces the Transform/Morph convergence animation
   * (e.g. Taylor / Fourier partial sums). Optional so existing saved scenes default
   * to the legacy 'individual' behavior.
   */
  displayMode?: FunctionSeriesDisplayMode;
  xDomain: [number, number] | null;
  defaults: FunctionSeriesDefaults;
  perN: Record<string, FunctionSeriesPerN>;
  /** Transient (recomputed in store); per-n validation messages keyed by n (stringified). */
  perNErrors?: Record<string, string>;
  /** Top-level validation error (e.g. nMin >= nMax, syntax, range too large). */
  topLevelError?: string | null;
}

// ── Point sequence (indexed points (x(n), y(n)) on axes) ──

/** Per-n style / timing overrides for a point sequence. */
export interface PointSequencePerN {
  color?: string;
  pointRadius?: number;
  animDuration?: number;
  waitAfter?: number;
}

/** Defaults for every index in a point sequence. */
export interface PointSequenceDefaults {
  color: string;
  /** Dot radius in scene units (Manim `Dot` radius). */
  pointRadius: number;
  animDuration: number;
  waitAfter: number;
}

/**
 * Sequence of points (x(n), y(n)) in graph coordinates for integer n in [nMin, nMax].
 * Accumulation keeps all dots; replacement fades out the previous dot then fades in the next.
 */
export interface GraphPointSequenceItem extends SceneItemBase {
  kind: 'graphPointSequence';
  axesId: ItemId;
  jsXExpr: string;
  jsYExpr: string;
  pyXExpr: string;
  pyYExpr: string;
  nMin: number;
  nMax: number;
  mode: FunctionSeriesMode;
  defaults: PointSequenceDefaults;
  perN: Record<string, PointSequencePerN>;
  perNErrors?: Record<string, string>;
  topLevelError?: string | null;
}

/** Resolve per-n fields with defaults for a point sequence. */
export function resolvePointSequenceN(
  item: GraphPointSequenceItem,
  n: number,
): PointSequenceDefaults {
  const override = item.perN[String(n)] ?? {};
  const d = item.defaults;
  return {
    color: override.color ?? d.color,
    pointRadius: override.pointRadius ?? d.pointRadius,
    animDuration: override.animDuration ?? d.animDuration,
    waitAfter: override.waitAfter ?? d.waitAfter,
  };
}

/** Same index rules as function series: nMin..nMax inclusive; empty if invalid. */
export function pointSequenceIndices(item: GraphPointSequenceItem): number[] {
  if (!Number.isFinite(item.nMin) || !Number.isFinite(item.nMax)) return [];
  const lo = Math.trunc(item.nMin);
  const hi = Math.trunc(item.nMax);
  if (lo >= hi) return [];
  const out: number[] = [];
  for (let n = lo; n <= hi; n++) out.push(n);
  return out;
}

export function pointSequenceChildStartOffset(
  item: GraphPointSequenceItem,
  n: number,
): number {
  const list = pointSequenceIndices(item);
  let t = 0;
  for (const k of list) {
    if (k === n) return t;
    const r = resolvePointSequenceN(item, k);
    t += Math.max(0, r.animDuration) + Math.max(0, r.waitAfter);
  }
  return t;
}

export function pointSequenceTotalDuration(item: GraphPointSequenceItem): number {
  const list = pointSequenceIndices(item);
  let dur = 0;
  const last = list[list.length - 1];
  for (const k of list) {
    const r = resolvePointSequenceN(item, k);
    dur += Math.max(0, r.animDuration);
    if (k !== last) dur += Math.max(0, r.waitAfter);
  }
  return dur;
}

export function pointSequenceHasErrors(item: GraphPointSequenceItem): boolean {
  if (item.topLevelError) return true;
  if (!item.perNErrors) return false;
  for (const v of Object.values(item.perNErrors)) {
    if (v) return true;
  }
  return false;
}

/** Plot/curve line style; legacy omit → solid. */
export function resolveGraphOverlayLineStyle(
  lineStyle: FunctionLineStyle | undefined,
): FunctionLineStyle {
  return lineStyle ?? 'solid';
}

/** Effective display mode; legacy items with no `displayMode` render as 'individual'. */
export function resolveFunctionSeriesDisplayMode(
  item: GraphFunctionSeriesItem,
): FunctionSeriesDisplayMode {
  return item.displayMode ?? 'individual';
}

/** Resolve per-n fields with defaults. */
export function resolveFunctionSeriesN(
  item: GraphFunctionSeriesItem,
  n: number,
): Required<FunctionSeriesPerN> {
  const override = item.perN[String(n)] ?? {};
  const d = item.defaults;
  return {
    color: override.color ?? d.color,
    strokeWidth: override.strokeWidth ?? d.strokeWidth,
    lineStyle: override.lineStyle ?? d.lineStyle,
    animDuration: override.animDuration ?? d.animDuration,
    waitAfter: override.waitAfter ?? d.waitAfter,
  };
}

/** Deterministic list of integer n from nMin..nMax (inclusive). Empty if invalid. */
export function functionSeriesIndices(item: GraphFunctionSeriesItem): number[] {
  if (!Number.isFinite(item.nMin) || !Number.isFinite(item.nMax)) return [];
  const lo = Math.trunc(item.nMin);
  const hi = Math.trunc(item.nMax);
  if (lo >= hi) return [];
  const out: number[] = [];
  for (let n = lo; n <= hi; n++) out.push(n);
  return out;
}

/** Cumulative offset (relative to item start) at which curve for index n begins its Create. */
export function functionSeriesChildStartOffset(
  item: GraphFunctionSeriesItem,
  n: number,
): number {
  const list = functionSeriesIndices(item);
  let t = 0;
  for (const k of list) {
    if (k === n) return t;
    const r = resolveFunctionSeriesN(item, k);
    t += Math.max(0, r.animDuration) + Math.max(0, r.waitAfter);
  }
  return t;
}

/** Total runtime of a function series (sum of per-n anim + wait). */
export function functionSeriesTotalDuration(
  item: GraphFunctionSeriesItem,
): number {
  const list = functionSeriesIndices(item);
  let t = 0;
  const last = list[list.length - 1];
  for (const k of list) {
    const r = resolveFunctionSeriesN(item, k);
    t += Math.max(0, r.animDuration);
    if (k !== last) t += Math.max(0, r.waitAfter);
  }
  return t;
}

/** True when the item has any per-n error or a top-level error. */
export function functionSeriesHasErrors(
  item: GraphFunctionSeriesItem,
): boolean {
  if (item.topLevelError) return true;
  if (!item.perNErrors) return false;
  for (const v of Object.values(item.perNErrors)) {
    if (v) return true;
  }
  return false;
}

/**
 * Default arrow-shaft / slope-tick stroke width in pixels. Shared between the
 * Konva preview and the emitted `ArrowVectorField.set_stroke(width=...)` so
 * existing projects migrated forward keep a consistent look.
 */
export const DEFAULT_FIELD_ARROW_STROKE_WIDTH = 4;

/** Vector or slope field (+ optional streamlines) on an existing axes. */
export interface GraphFieldItem extends SceneItemBase {
  kind: 'graphField';
  axesId: ItemId;
  fieldMode: GraphFieldMode;
  pyExprSlope: string;
  jsExprSlope: string;
  slopeArrowLength: number;
  pyExprP: string;
  pyExprQ: string;
  jsExprP: string;
  jsExprQ: string;
  fieldGridStep: number;
  fieldColormap: GraphFieldColormap;
  colorSchemeMin: number;
  colorSchemeMax: number;
  /**
   * Stroke width of each arrow shaft / slope tick, in pixels. Fed directly
   * into Konva preview (`strokeWidth`) and emitted as `set_stroke(width=...)`
   * on the ArrowVectorField after `fit_to_coordinate_system` so the video
   * and preview agree. Defaults via factory/migration to {@link DEFAULT_FIELD_ARROW_STROKE_WIDTH}.
   */
  arrowStrokeWidth: number;
  streamPoints: GraphStreamPoint[];
  streamPlacementActive?: boolean;
  streamDt: number;
  streamVirtualTime: number;
}

export type SceneItem =
  | TextLineItem
  | AxesItem
  | GraphPlotItem
  | GraphCurveItem
  | GraphDotItem
  | GraphFieldItem
  | GraphFunctionSeriesItem
  | GraphPointSequenceItem
  | GraphAreaItem
  | ShapeItem
  | ExitAnimationItem
  | BlinkAnimationItem
  | TargetAnimationItem
  | SurroundingRectItem;

/** True for visual items present from scene start via `visibleAtSceneStart` (not exit clips). */
export function isVisibleAtSceneStartItem(item: SceneItem): boolean {
  if (
    item.kind === 'exit_animation' ||
    item.kind === 'blink_animation' ||
    item.kind === 'target_animation'
  ) {
    return false;
  }
  return item.visibleAtSceneStart === true;
}

// ── Project file ──

export interface SceneDefaults {
  font: string;
  fontSize: number;
  mathColor: string;
  exportNamePrefix: string;
  /** Shown in UI; full-file export uses a sanitized Python class name (see pythonIdent.safeSceneClassName). */
  sceneName: string;
}

export interface MeasureConfig {
  url: string;
  enabled: boolean;
  includePreview: boolean;
}

export interface ProjectFile {
  version: number;
  savedAt: string;
  defaults: SceneDefaults;
  items: SceneItem[];
  measureConfig: MeasureConfig;
  audioItems?: AudioTrackItem[];
}

/** Portable subset of a project for merge into another scene (not a full save file). */
export const PROJECT_FRAGMENT_KIND = 'manim-timeline-fragment' as const;

export interface ProjectFragmentFile {
  kind: typeof PROJECT_FRAGMENT_KIND;
  version: number;
  savedAt: string;
  items: SceneItem[];
  audioItems?: AudioTrackItem[];
}

export function isProjectFragmentFile(v: unknown): v is ProjectFragmentFile {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    o.kind === PROJECT_FRAGMENT_KIND &&
    typeof o.version === 'number' &&
    typeof o.savedAt === 'string' &&
    Array.isArray(o.items)
  );
}
