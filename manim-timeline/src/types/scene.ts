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
  refKind: 'line' | 'graph';
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
  voiceText: string;
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

// ── Voiceover ──

export type AnimMode = 'runtime' | 'voiceover';
export type VoiceKind = 'tts' | 'recorder';

export interface VoiceoverConfig {
  animMode: AnimMode;
  voiceKind: VoiceKind;
  /** When set, export ties this clip to a specific `audioItems` track (Whisper boundaries). */
  audioTrackId?: string | null;
  script: string;
  preamble: string;
  singleTakeBookmarks: boolean;
  mergeWithNext: boolean;
  perSegmentNarration: boolean;
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

interface SceneItemBase extends TimeSpan, SpatialTransform {
  id: ItemId;
  label: string;
  layer: number;
  waitAfter: number;
  posSteps: PosStep[];
  voice: VoiceoverConfig;
  exitAnimStyle?: 'fade_out' | 'uncreate' | 'shrink_to_center' | 'none';
  exitRunTime?: number;
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
  voiceText: string;
}

export interface GraphDot {
  id: ItemId;
  dx: number;
  dy: number;
  color: string;
  radius: number;
  label: string;
  labelDir: ManimDirection;
  voiceText: string;
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
  waitAfter: number;
  /** Ordered list of child text line ids */
  childIds: ItemId[];
  /**
   * When true, all child lines are shifted together so the bounding box of the
   * chain is centered on x=0 (preview + export). Uses measured widths when available.
   */
  centerHorizontally?: boolean;
}

export interface GraphItem extends SceneItemBase {
  kind: 'graph';
  xRange: [number, number, number];
  yRange: [number, number, number];
  xLabel: string;
  yLabel: string;
  includeNumbers: boolean;
  includeTip: boolean;
  functions: GraphFunction[];
  dots: GraphDot[];
  perPartVoice: boolean;
  voiceAxesScript: string;
  voiceLabelsScript: string;
}

export type SceneItem = TextLineItem | GraphItem | CompoundItem;

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
