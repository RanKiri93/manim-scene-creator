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
export interface PosStepNextTo {
  kind: 'next_to';
  refKind: 'line' | 'axes' | 'shape';
  refId: ItemId | null;
  dir: ManimDirection;
  buff: number;
}
export interface PosStepToEdge { kind: 'to_edge'; edge: ManimDirection; buff: number }
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
  /** When set, export ties this clip to a specific `audioItems` track (Whisper boundaries). */
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

/** Highlight box around another object; optional label; remove with a normal exit clip. */
export interface SurroundingRectItem {
  kind: 'surroundingRect';
  id: ItemId;
  label: string;
  layer: number;
  startTime: number;
  duration: number;
  targetId: ItemId;
  /**
   * When the target is a `textLine`, optional 0-based segment indices on the exported
   * `HebrewMathLine` (omit or empty = surround the whole line).
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
  introRunTime: number;
}

export type ShapeKind = 'circle' | 'rectangle' | 'arrow' | 'line';

/** Primitive shape: circle, rectangle, arrow, or line; positioned like other scene objects. */
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
  /** If set, this line belongs to a compound clip; use localStart/localDuration (seconds from compound start). */
  parentId?: ItemId | null;
  localStart?: number;
  localDuration?: number;
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

/** Sequence: (n, a_n); series: (n, partial sum of a_i); partialPlot: y = sum_k term(k,x) over x. */
export type SeriesVizMode = 'sequence' | 'series' | 'partialPlot';

/** discrete: floor index vs time; smooth: fractional n for head interpolation. */
export type SeriesNMapping = 'linear_discrete' | 'linear_smooth';

/** Easing on progress u in [0,1] before mapping to n. */
export type SeriesNEasing = 'linear' | 'ease_out' | 'ease_in_out';

/**
 * Animated sequence / series / partial-sum plot on axes. Index n is driven by clip-local time.
 */
export interface GraphSeriesVizItem extends SceneItemBase {
  kind: 'graphSeriesViz';
  axesId: ItemId;
  vizMode: SeriesVizMode;
  nMin: number;
  nMax: number;
  nMapping: SeriesNMapping;
  nEasing: SeriesNEasing;
  /** Sequence/series: a(n). partialPlot: term(k, x) — use k and x. */
  jsExpr: string;
  pyExpr: string;
  ghostCount: number;
  ghostOpacityMin: number;
  ghostOpacityMax: number;
  showHeadDot: boolean;
  strokeColor: string;
  headColor: string;
  strokeWidth: number;
  /** Optional horizontal line y = L (graph coordinates); null to hide. */
  limitY: number | null;
}

/**
 * Groups multiple text lines as one clip on the main timeline.
 * Children are TextLineItems with `parentId` pointing here; they use localStart/localDuration.
 */
export interface CompoundItem {
  kind: 'compound';
  id: ItemId;
  label: string;
  layer: number;
  startTime: number;
  duration: number;
  /** Ordered list of child text line ids */
  childIds: ItemId[];
  /**
   * When true, all child lines are shifted together so the bounding box of the
   * chain is centered on x=0 (preview + export). Uses measured widths when available.
   */
  centerHorizontally?: boolean;
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
}

/** One function plot on an existing axes. */
export interface GraphPlotItem extends SceneItemBase {
  kind: 'graphPlot';
  axesId: ItemId;
  fn: GraphFunction;
}

/** One labeled dot on an existing axes. */
export interface GraphDotItem extends SceneItemBase {
  kind: 'graphDot';
  axesId: ItemId;
  dot: GraphDot;
}

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
  streamPoints: GraphStreamPoint[];
  streamPlacementActive?: boolean;
  streamDt: number;
  streamVirtualTime: number;
}

export type SceneItem =
  | TextLineItem
  | AxesItem
  | GraphPlotItem
  | GraphDotItem
  | GraphFieldItem
  | GraphSeriesVizItem
  | ShapeItem
  | CompoundItem
  | ExitAnimationItem
  | SurroundingRectItem;

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
