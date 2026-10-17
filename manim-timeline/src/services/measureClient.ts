import type {
  TextLineItem,
  AudioTrackItem,
  AudioBed,
  MeasureResult,
  SegmentStyle,
  SegmentLocalBox,
  TextBaseDir,
  MathChildLocalBox,
  AxesItem,
  AxisPreviewBounds,
  MatrixItem,
  MatrixMeasure,
} from '@/types/scene';
import { matrixEntryColors } from '@/lib/matrix';
import {
  deriveAudioBedAssetRelPath,
} from '@/lib/audioAssetPath';
import type { AudioMixdownSpec } from '@/lib/audioMixdown';
import { buildExportParts } from '@/codegen/texUtils';
import {
  AXES_PREVIEW_METADATA_VERSION,
  type AxesPreviewRequestBody,
  buildAxesPreviewRequestBody,
} from '@/lib/axesPreviewRequest';

interface MeasureRequestBody {
  tex: string;
  /** Exact `HebrewMathLine(...)` arguments the exporter emits; the server builds from these. */
  parts: string[];
  hebrew_font: string | null;
  font_size: number;
  math_font: null;
  /** `null` = same as the Hebrew font. */
  english_font: string | null;
  base_dir: TextBaseDir;
  include_preview: boolean;
  segment_styles: {
    parse_index: number;
    color: string | null;
    bold: boolean;
    italic: boolean;
  }[];
}

interface SegmentBoxBody {
  cx: number;
  cy: number;
  w: number;
  h: number;
  is_math?: boolean | null;
}

interface MathChildBoxBody {
  child_index: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

interface MathSegmentChildrenBody {
  segment_index: number;
  children: MathChildBoxBody[];
}

interface MeasureResponseBody {
  ok: boolean;
  width?: number;
  height?: number;
  width_ink?: number;
  height_ink?: number;
  offset_ink_x?: number;
  offset_ink_y?: number;
  ink_left_x?: number;
  ink_right_x?: number;
  ink_top_y?: number;
  ink_bottom_y?: number;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  png_base64?: string;
  png_width?: number;
  png_height?: number;
  segment_boxes?: SegmentBoxBody[];
  math_child_boxes?: MathSegmentChildrenBody[];
  error?: string;
}

function flattenMathChildBoxes(
  raw: MathSegmentChildrenBody[] | undefined,
): MathChildLocalBox[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: MathChildLocalBox[] = [];
  for (const row of raw) {
    const si = row.segment_index;
    if (!Number.isInteger(si) || si < 0) continue;
    for (const ch of row.children ?? []) {
      const ci = ch.child_index;
      if (!Number.isInteger(ci) || ci < 0) continue;
      out.push({
        segmentIndex: si,
        childIndex: ci,
        cx: ch.cx,
        cy: ch.cy,
        w: ch.w,
        h: ch.h,
      });
    }
  }
  return out.length > 0 ? out : null;
}

function buildSegmentStyles(segments: SegmentStyle[]) {
  return segments.map((s, i) => ({
    parse_index: i,
    color: s.color || null,
    bold: s.bold,
    italic: s.italic,
  }));
}

const MEASURE_FETCH_HINT =
  'Start measure_server from the ManimStuff repo root, e.g. ' +
  'python -m uvicorn measure_server:app --host 127.0.0.1 --port 8765. ' +
  'Then set Measure server URL in app settings to match (default http://127.0.0.1:8765).';

/**
 * Wraps `fetch` so connection failures (browser: "NetworkError" / TypeError: Failed to fetch)
 * show a clear hint instead of a bare network error.
 */
async function measureFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    const message =
      e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    throw new Error(`${message}\n${MEASURE_FETCH_HINT}\nRequest: ${url}`);
  }
}

export async function measureLine(
  baseUrl: string,
  item: TextLineItem,
  includePreview: boolean,
): Promise<{ result: MeasureResult | null; error: string | null }> {
  const body: MeasureRequestBody = {
    tex: item.raw,
    parts: buildExportParts(item.raw, item.segments, item.baseDir ?? 'rtl'),
    english_font: item.englishFont?.trim() || null,
    base_dir: item.baseDir ?? 'rtl',
    hebrew_font: item.font?.trim() || null,
    font_size: item.fontSize,
    math_font: null,
    include_preview: includePreview,
    segment_styles: buildSegmentStyles(item.segments),
  };

  const resp = await measureFetch(`${baseUrl.replace(/\/$/, '')}/measure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const j: MeasureResponseBody = await resp.json();

  if (!j.ok) {
    return { result: null, error: j.error ?? 'Unknown error' };
  }

  const segmentMeasures: SegmentLocalBox[] | null = Array.isArray(j.segment_boxes)
    ? j.segment_boxes.map((b) => ({
        cx: b.cx,
        cy: b.cy,
        w: b.w,
        h: b.h,
        isMath: b.is_math ?? null,
      }))
    : null;

  const mathChildMeasures = flattenMathChildBoxes(j.math_child_boxes);

  const result: MeasureResult = {
    width: j.width!,
    height: j.height!,
    widthInk: j.width_ink ?? j.width!,
    heightInk: j.height_ink ?? j.height!,
    offsetInkX: j.offset_ink_x ?? 0,
    offsetInkY: j.offset_ink_y ?? 0,
    inkLeftX: j.ink_left_x ?? 0,
    inkRightX: j.ink_right_x ?? 0,
    inkTopY: j.ink_top_y ?? 0,
    inkBottomY: j.ink_bottom_y ?? 0,
    bboxLeft: j.left ?? 0,
    bboxRight: j.right ?? 0,
    bboxTop: j.top ?? 0,
    bboxBottom: j.bottom ?? 0,
    pngBase64: j.png_base64 ?? null,
    pngWidth: j.png_width ?? null,
    pngHeight: j.png_height ?? null,
    segmentMeasures,
    mathChildMeasures,
  };

  return { result, error: null };
}

interface MatrixBoxBody {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

interface MatrixMeasureResponseBody {
  ok: boolean;
  width?: number;
  height?: number;
  width_ink?: number;
  height_ink?: number;
  offset_ink_x?: number;
  offset_ink_y?: number;
  ink_left_x?: number;
  ink_right_x?: number;
  ink_top_y?: number;
  ink_bottom_y?: number;
  png_base64?: string | null;
  cell_boxes?: (MatrixBoxBody & { row: number; col: number })[] | null;
  left_bracket_box?: MatrixBoxBody | null;
  right_bracket_box?: MatrixBoxBody | null;
  bar_box?: MatrixBoxBody | null;
  error?: string | null;
}

const box = (b: MatrixBoxBody | null | undefined) => (b ? { cx: b.cx, cy: b.cy, w: b.w, h: b.h } : null);

/** Typeset a matrix exactly as the export's `HebrewMatrix` and return its geometry (and preview PNG). */
export async function measureMatrix(
  baseUrl: string,
  item: MatrixItem,
  includePreview: boolean,
): Promise<{ measure: MatrixMeasure | null; previewDataUrl: string | null; error: string | null }> {
  const body = {
    entries: item.entries,
    bracket: item.bracket,
    align: item.align,
    augment_col: item.augmentCol ?? null,
    row_spacing: item.rowSpacing,
    col_spacing: item.colSpacing,
    font_size: item.fontSize,
    color: item.color,
    entry_colors: matrixEntryColors(item),
    include_preview: includePreview,
  };
  const resp = await measureFetch(`${baseUrl.replace(/\/$/, '')}/api/measure_matrix`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) return { measure: null, previewDataUrl: null, error: `Measure server: HTTP ${resp.status}` };
  const j = (await resp.json()) as MatrixMeasureResponseBody;
  if (!j.ok) return { measure: null, previewDataUrl: null, error: j.error ?? 'Unknown error' };
  const measure: MatrixMeasure = {
    width: j.width!,
    height: j.height!,
    widthInk: j.width_ink ?? j.width!,
    heightInk: j.height_ink ?? j.height!,
    offsetInkX: j.offset_ink_x ?? 0,
    offsetInkY: j.offset_ink_y ?? 0,
    inkLeftX: j.ink_left_x ?? -j.width! / 2,
    inkRightX: j.ink_right_x ?? j.width! / 2,
    inkTopY: j.ink_top_y ?? j.height! / 2,
    inkBottomY: j.ink_bottom_y ?? -j.height! / 2,
    cells: (j.cell_boxes ?? []).map((b) => ({ row: b.row, col: b.col, cx: b.cx, cy: b.cy, w: b.w, h: b.h })),
    leftBracket: box(j.left_bracket_box),
    rightBracket: box(j.right_bracket_box),
    bar: box(j.bar_box),
  };
  return {
    measure,
    previewDataUrl: j.png_base64 ? `data:image/png;base64,${j.png_base64}` : null,
    error: null,
  };
}

export interface AxesPreviewApiResult {
  dataUrl: string | null;
  pngWidth: number | null;
  pngHeight: number | null;
  bounds: AxisPreviewBounds | null;
  error: string | null;
}

interface AxesPreviewResponseBody {
  ok: boolean;
  metadata_version?: number;
  png_base64?: string;
  png_width?: number;
  png_height?: number;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  offset_ink_x?: number;
  offset_ink_y?: number;
  origin_x?: number;
  origin_y?: number;
  x_unit_x?: number;
  x_unit_y?: number;
  y_unit_x?: number;
  y_unit_y?: number;
  coord_left?: number;
  coord_right?: number;
  coord_top?: number;
  coord_bottom?: number;
  error?: string;
}

/**
 * Rasterize axes via measure server (same Manim toolchain as `/measure`).
 */
export async function previewAxes(
  baseUrl: string,
  item: AxesItem,
): Promise<AxesPreviewApiResult> {
  const body: AxesPreviewRequestBody = buildAxesPreviewRequestBody(item);
  const resp = await measureFetch(
    `${baseUrl.replace(/\/$/, '')}/api/preview_axes`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  let j: AxesPreviewResponseBody;
  try {
    j = (await resp.json()) as AxesPreviewResponseBody;
  } catch {
    return {
      dataUrl: null,
      pngWidth: null,
      pngHeight: null,
      bounds: null,
      error: `preview_axes: HTTP ${resp.status}`,
    };
  }
  if (!resp.ok || !j.ok) {
    return {
      dataUrl: null,
      pngWidth: null,
      pngHeight: null,
      bounds: null,
      error: j.error ?? `preview_axes: HTTP ${resp.status}`,
    };
  }
  const b64 = j.png_base64?.trim();
  const dataUrl = b64 ? `data:image/png;base64,${b64}` : null;
  const anchorValues = [j.origin_x, j.origin_y, j.x_unit_x, j.x_unit_y, j.y_unit_x, j.y_unit_y, j.coord_left, j.coord_right, j.coord_top, j.coord_bottom];
  const hasV1Anchors = j.metadata_version === AXES_PREVIEW_METADATA_VERSION && anchorValues.every((value) => typeof value === 'number' && Number.isFinite(value));
  const bounds =
    dataUrl &&
    hasV1Anchors &&
    Number.isFinite(j.png_width) && j.png_width! > 0 &&
    Number.isFinite(j.png_height) && j.png_height! > 0 &&
    j.left != null &&
    j.right != null &&
    j.top != null &&
    j.bottom != null &&
    j.offset_ink_x != null &&
    j.offset_ink_y != null
      ? {
          left: j.left,
          right: j.right,
          top: j.top,
          bottom: j.bottom,
          offsetInkX: j.offset_ink_x,
          offsetInkY: j.offset_ink_y,
          metadataVersion: AXES_PREVIEW_METADATA_VERSION,
          originX: j.origin_x!,
          originY: j.origin_y!,
          xUnitX: j.x_unit_x!,
          xUnitY: j.x_unit_y!,
          yUnitX: j.y_unit_x!,
          yUnitY: j.y_unit_y!,
          coordLeft: j.coord_left!,
          coordRight: j.coord_right!,
          coordTop: j.coord_top!,
          coordBottom: j.coord_bottom!,
        }
      : null;
  return {
    dataUrl,
    pngWidth: j.png_width ?? null,
    pngHeight: j.png_height ?? null,
    bounds,
    error: !dataUrl
      ? 'preview_axes: raster image is unavailable; using vector axes.'
      : !bounds
        ? 'preview_axes: origin-anchor metadata version 1 is missing or invalid; using vector axes.'
        : null,
  };
}

export async function checkHealth(baseUrl: string): Promise<boolean> {
  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/health`);
    const j = await resp.json();
    return j.status === 'ok';
  } catch {
    return false;
  }
}

export interface GenerateAudioApiResult {
  audioBase64: string;
  duration: number;
  boundaries: { word: string; start: number; end: number }[];
  /** Persisted under measure-server ``assets/audio/`` (same as upload). */
  filePath: string;
}

interface GenerateAudioResponseBody {
  audio_base64: string;
  duration: number;
  word_boundaries: { word: string; start: number; end: number }[];
  file_path: string;
  detail?: string | { msg?: string }[];
}

export async function generateAudio(
  baseUrl: string,
  text: string,
  lang: string,
): Promise<GenerateAudioApiResult> {
  const resp = await measureFetch(`${baseUrl.replace(/\/$/, '')}/api/generate_audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, lang }),
  });
  const j = (await resp.json()) as GenerateAudioResponseBody;
  if (!resp.ok) {
    const msg =
      typeof j.detail === 'string'
        ? j.detail
        : Array.isArray(j.detail)
          ? j.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join('; ')
          : `HTTP ${resp.status}`;
    throw new Error(msg || 'generate_audio failed');
  }
  const fp = j.file_path?.trim();
  if (!fp) {
    throw new Error(
      'generate_audio: missing file_path — update measure_server so TTS files are saved for export/render',
    );
  }
  return {
    audioBase64: j.audio_base64,
    duration: j.duration,
    boundaries: (j.word_boundaries ?? []).map((w) => ({
      word: w.word,
      start: w.start,
      end: w.end,
    })),
    filePath: fp,
  };
}

export interface UploadRecordedAudioResult {
  file_path: string;
  duration?: number;
  word_boundaries: { word: string; start: number; end: number }[];
}

interface UploadRecordedAudioResponseBody {
  file_path?: string;
  duration?: number;
  word_boundaries?: { word: string; start: number; end: number }[];
  detail?: string | { msg?: string }[];
}

export async function uploadRecordedAudio(
  baseUrl: string,
  blob: Blob,
  filename: string = 'recording.webm',
  options?: { lang?: string; script?: string; transcribe?: boolean },
): Promise<UploadRecordedAudioResult> {
  const formData = new FormData();
  const safeName = filename.trim() || 'recording.webm';
  formData.append('file', blob, safeName);
  const lang = options?.lang?.trim();
  if (lang) formData.append('lang', lang);
  const script = options?.script?.trim();
  if (script) formData.append('script', script);
  if (options?.transcribe === false) {
    formData.append('transcribe', 'false');
  }
  const resp = await measureFetch(`${baseUrl.replace(/\/$/, '')}/api/upload_audio`, {
    method: 'POST',
    body: formData,
  });
  const j = (await resp.json()) as UploadRecordedAudioResponseBody;
  if (!resp.ok) {
    const msg =
      typeof j.detail === 'string'
        ? j.detail
        : Array.isArray(j.detail)
          ? j.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join('; ')
          : `HTTP ${resp.status}`;
    throw new Error(msg || 'upload_audio failed');
  }
  if (!j.file_path || typeof j.file_path !== 'string') {
    throw new Error('upload_audio: missing file_path');
  }
  const word_boundaries = (j.word_boundaries ?? []).map((w) => ({
    word: w.word,
    start: w.start,
    end: w.end,
  }));
  return { file_path: j.file_path, duration: j.duration, word_boundaries };
}

interface SyncAudioAssetResponseBody {
  file_path?: string;
  bytes?: number;
  detail?: string | { msg?: string }[];
}

function renderAssetRelPath(track: AudioTrackItem): string | null {
  const rel = track.assetRelPath?.trim().replace(/^\/+/, '');
  return rel?.startsWith('assets/audio/') ? rel : null;
}

export async function syncRenderAudioAssets(
  baseUrl: string,
  tracks: AudioTrackItem[],
  bed?: AudioBed | null,
): Promise<void> {
  const root = baseUrl.replace(/\/$/, '');
  for (const track of tracks) {
    const relPath = renderAssetRelPath(track);
    if (!relPath) continue;

    const resp = await fetch(track.audioUrl);
    if (!resp.ok) {
      throw new Error(
        `Could not read bundled audio asset ${relPath}: HTTP ${resp.status}`,
      );
    }
    const blob = await resp.blob();
    const formData = new FormData();
    formData.append('rel_path', relPath);
    formData.append('file', blob, relPath.split('/').pop() || 'audio');

    const syncResp = await measureFetch(`${root}/api/sync_audio_asset`, {
      method: 'POST',
      body: formData,
    });
    if (!syncResp.ok) {
      const text = await syncResp.text();
      let msg = text.trim() || `HTTP ${syncResp.status}`;
      try {
        const j = JSON.parse(text) as SyncAudioAssetResponseBody;
        if (typeof j.detail === 'string') {
          msg = j.detail;
        } else if (Array.isArray(j.detail)) {
          const parts = j.detail.map((d) => d.msg).filter(Boolean);
          if (parts.length) msg = parts.join('; ');
        }
      } catch {
        /* use raw text */
      }
      throw new Error(`Could not sync audio asset ${relPath}: ${msg}`);
    }
  }

  if (!bed) return;
  const bedRel =
    bed.assetRelPath?.trim().replace(/^\/+/, '') ??
    deriveAudioBedAssetRelPath(bed);
  if (!bedRel.startsWith('assets/audio/')) return;

  const bedResp = await fetch(bed.audioUrl);
  if (!bedResp.ok) {
    throw new Error(
      `Could not read background bed asset ${bedRel}: HTTP ${bedResp.status}`,
    );
  }
  const bedBlob = await bedResp.blob();
  const bedForm = new FormData();
  bedForm.append('rel_path', bedRel);
  bedForm.append('file', bedBlob, bedRel.split('/').pop() || 'bed');

  const bedSync = await measureFetch(`${root}/api/sync_audio_asset`, {
    method: 'POST',
    body: bedForm,
  });
  if (!bedSync.ok) {
    const text = await bedSync.text();
    throw new Error(
      `Could not sync background bed ${bedRel}: ${text.trim() || `HTTP ${bedSync.status}`}`,
    );
  }
}

export interface MixdownAudioApiResult {
  file_path: string;
  duration: number;
}

export async function mixdownAudio(
  baseUrl: string,
  spec: AudioMixdownSpec,
): Promise<MixdownAudioApiResult> {
  const resp = await measureFetch(`${baseUrl.replace(/\/$/, '')}/api/mixdown_audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      total_duration_sec: spec.total_duration_sec,
      clips: spec.clips.map((c) => ({
        rel_path: c.rel_path,
        start_sec: c.start_sec,
        fade_in_ms: c.fade_in_ms,
        fade_out_ms: c.fade_out_ms,
        gain_db: c.gain_db ?? 0,
      })),
      bed: spec.bed
        ? { rel_path: spec.bed.rel_path, gain_db: spec.bed.gain_db }
        : null,
    }),
  });
  const j = (await resp.json()) as {
    file_path?: string;
    duration?: number;
    detail?: string | { msg?: string }[];
  };
  if (!resp.ok) {
    const msg =
      typeof j.detail === 'string'
        ? j.detail
        : Array.isArray(j.detail)
          ? j.detail.map((d) => d.msg).filter(Boolean).join('; ')
          : `HTTP ${resp.status}`;
    throw new Error(msg || 'mixdown_audio failed');
  }
  if (!j.file_path || typeof j.file_path !== 'string') {
    throw new Error('mixdown_audio: missing file_path');
  }
  const dur = Number(j.duration);
  return {
    file_path: j.file_path,
    duration: Number.isFinite(dur) && dur > 0 ? dur : spec.total_duration_sec,
  };
}

export type BedNoiseColor = 'pink' | 'brown' | 'white';

export interface GenerateBedNoiseApiResult {
  file_path: string;
  duration: number;
}

export async function generateBedNoise(
  baseUrl: string,
  options: {
    color?: BedNoiseColor;
    durationSec?: number;
    levelDb?: number;
  },
): Promise<GenerateBedNoiseApiResult> {
  const resp = await measureFetch(`${baseUrl.replace(/\/$/, '')}/api/generate_bed_noise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      color: options.color ?? 'pink',
      duration_sec: options.durationSec ?? 8,
      level_db: options.levelDb ?? -40,
    }),
  });
  const j = (await resp.json()) as {
    file_path?: string;
    duration?: number;
    detail?: string | { msg?: string }[];
  };
  if (!resp.ok) {
    const msg =
      typeof j.detail === 'string'
        ? j.detail
        : Array.isArray(j.detail)
          ? j.detail.map((d) => d.msg).filter(Boolean).join('; ')
          : `HTTP ${resp.status}`;
    throw new Error(msg || 'generate_bed_noise failed');
  }
  if (!j.file_path || typeof j.file_path !== 'string') {
    throw new Error('generate_bed_noise: missing file_path');
  }
  const dur = Number(j.duration);
  return {
    file_path: j.file_path,
    duration: Number.isFinite(dur) && dur > 0 ? dur : options.durationSec ?? 8,
  };
}

export interface NormalizeAudioApiResult {
  file_path: string;
  duration: number;
  measured_input_lufs?: number | null;
  measured_output_lufs?: number | null;
}

interface NormalizeAudioResponseBody {
  file_path?: string;
  duration?: number;
  measured_input_lufs?: number | null;
  measured_output_lufs?: number | null;
  detail?: string | { msg?: string }[];
}

/**
 * EBU R128 loudness normalization via measure server ``/api/normalize_audio`` (ffmpeg loudnorm).
 * Provide exactly one of ``sourcePath`` (existing ``assets/audio/...`` on the server) or ``file`` bytes.
 */
export async function normalizeAudio(
  baseUrl: string,
  opts: {
    sourcePath?: string;
    file?: Blob;
    filename?: string;
    targetLufs?: number;
    truePeak?: number;
    lra?: number;
  },
): Promise<NormalizeAudioApiResult> {
  const sp = opts.sourcePath?.trim();
  const file = opts.file;
  if ((!sp && !file) || (Boolean(sp) && Boolean(file))) {
    throw new Error('normalizeAudio: provide exactly one of sourcePath or file');
  }

  const formData = new FormData();
  if (sp) {
    formData.append('source_path', sp);
  }
  if (file) {
    formData.append('file', file, opts.filename ?? 'audio.wav');
  }
  formData.append('target_lufs', String(opts.targetLufs ?? -16));
  formData.append('true_peak', String(opts.truePeak ?? -1.5));
  formData.append('lra', String(opts.lra ?? 11));

  const resp = await measureFetch(
    `${baseUrl.replace(/\/$/, '')}/api/normalize_audio`,
    {
      method: 'POST',
      body: formData,
    },
  );
  const j = (await resp.json()) as NormalizeAudioResponseBody;
  if (!resp.ok) {
    const msg =
      typeof j.detail === 'string'
        ? j.detail
        : Array.isArray(j.detail)
          ? j.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join('; ')
          : `HTTP ${resp.status}`;
    throw new Error(msg || 'normalize_audio failed');
  }
  if (!j.file_path || typeof j.file_path !== 'string') {
    throw new Error('normalize_audio: missing file_path');
  }
  const dur =
    typeof j.duration === 'number' && Number.isFinite(j.duration)
      ? j.duration
      : Number(j.duration);
  if (!Number.isFinite(dur) || dur <= 0) {
    throw new Error('normalize_audio: invalid duration');
  }
  return {
    file_path: j.file_path,
    duration: dur,
    measured_input_lufs:
      j.measured_input_lufs == null || j.measured_input_lufs === undefined
        ? null
        : Number(j.measured_input_lufs),
    measured_output_lufs:
      j.measured_output_lufs == null || j.measured_output_lufs === undefined
        ? null
        : Number(j.measured_output_lufs),
  };
}

export interface ProcessAudioApiResult {
  file_path: string;
  duration: number;
  measured_input_lufs?: number | null;
  measured_output_lufs?: number | null;
  measured_input_noise_floor_db?: number | null;
}

interface ProcessAudioResponseBody {
  file_path?: string;
  duration?: number;
  measured_input_lufs?: number | null;
  measured_output_lufs?: number | null;
  measured_input_noise_floor_db?: number | null;
  detail?: string | { msg?: string }[];
}

/**
 * Full deterministic voice cleanup chain (high-pass + denoise + compress) then EBU R128 loudnorm,
 * via measure server ``/api/process_audio`` (ffmpeg). Applying identical settings to every clip is
 * what makes sentence-by-sentence takes sound consistent.
 * Provide exactly one of ``sourcePath`` (existing ``assets/audio/...`` on the server) or ``file`` bytes.
 */
export async function processAudio(
  baseUrl: string,
  opts: {
    sourcePath?: string;
    file?: Blob;
    filename?: string;
    targetLufs?: number;
    truePeak?: number;
    lra?: number;
    highpassHz?: number;
    denoise?: boolean;
    denoiseDb?: number;
    compress?: boolean;
  },
): Promise<ProcessAudioApiResult> {
  const sp = opts.sourcePath?.trim();
  const file = opts.file;
  if ((!sp && !file) || (Boolean(sp) && Boolean(file))) {
    throw new Error('processAudio: provide exactly one of sourcePath or file');
  }

  const formData = new FormData();
  if (sp) {
    formData.append('source_path', sp);
  }
  if (file) {
    formData.append('file', file, opts.filename ?? 'audio.wav');
  }
  formData.append('target_lufs', String(opts.targetLufs ?? -16));
  formData.append('true_peak', String(opts.truePeak ?? -1.5));
  formData.append('lra', String(opts.lra ?? 11));
  formData.append('highpass_hz', String(opts.highpassHz ?? 80));
  // Denoise defaults OFF: the FFT denoiser adds metallic/"musical" artifacts on already-clean
  // raw captures. Loudness normalization + light high-pass/compression give consistency without it.
  formData.append('denoise', String(opts.denoise ?? false));
  formData.append('denoise_db', String(opts.denoiseDb ?? 8));
  formData.append('compress', String(opts.compress ?? true));

  const resp = await measureFetch(
    `${baseUrl.replace(/\/$/, '')}/api/process_audio`,
    {
      method: 'POST',
      body: formData,
    },
  );
  const j = (await resp.json()) as ProcessAudioResponseBody;
  if (!resp.ok) {
    const msg =
      typeof j.detail === 'string'
        ? j.detail
        : Array.isArray(j.detail)
          ? j.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join('; ')
          : `HTTP ${resp.status}`;
    throw new Error(msg || 'process_audio failed');
  }
  if (!j.file_path || typeof j.file_path !== 'string') {
    throw new Error('process_audio: missing file_path');
  }
  const dur =
    typeof j.duration === 'number' && Number.isFinite(j.duration)
      ? j.duration
      : Number(j.duration);
  if (!Number.isFinite(dur) || dur <= 0) {
    throw new Error('process_audio: invalid duration');
  }
  const num = (v: number | null | undefined) =>
    v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null;
  return {
    file_path: j.file_path,
    duration: dur,
    measured_input_lufs: num(j.measured_input_lufs),
    measured_output_lufs: num(j.measured_output_lufs),
    measured_input_noise_floor_db: num(j.measured_input_noise_floor_db),
  };
}

export interface MatchEqBand {
  freq: number;
  gainDb: number;
}

export interface MatchEqApiResult {
  file_path: string;
  duration: number;
  measured_input_lufs?: number | null;
  measured_output_lufs?: number | null;
  bands: MatchEqBand[];
}

interface MatchEqResponseBody {
  file_path?: string;
  duration?: number;
  measured_input_lufs?: number | null;
  measured_output_lufs?: number | null;
  bands?: { freq: number; gain_db: number }[];
  detail?: string | { msg?: string }[];
}

/**
 * Match the tonal balance of a target clip to a reference take via measure server ``/api/match_eq``
 * (corrective multiband EQ derived from the two clips' average spectra, then EBU R128 loudnorm).
 * Provide the target as exactly one of ``sourcePath`` or ``file``; ``referencePath`` is a server
 * ``assets/audio/...`` path of the reference clip.
 */
export async function matchEq(
  baseUrl: string,
  opts: {
    referencePath: string;
    sourcePath?: string;
    file?: Blob;
    filename?: string;
    targetLufs?: number;
    truePeak?: number;
    lra?: number;
    maxGainDb?: number;
  },
): Promise<MatchEqApiResult> {
  const ref = opts.referencePath?.trim();
  if (!ref) {
    throw new Error('matchEq: referencePath is required');
  }
  const sp = opts.sourcePath?.trim();
  const file = opts.file;
  if ((!sp && !file) || (Boolean(sp) && Boolean(file))) {
    throw new Error('matchEq: provide exactly one of sourcePath or file');
  }

  const formData = new FormData();
  formData.append('reference_path', ref);
  if (sp) {
    formData.append('source_path', sp);
  }
  if (file) {
    formData.append('file', file, opts.filename ?? 'audio.wav');
  }
  formData.append('target_lufs', String(opts.targetLufs ?? -16));
  formData.append('true_peak', String(opts.truePeak ?? -1.5));
  formData.append('lra', String(opts.lra ?? 11));
  formData.append('max_gain_db', String(opts.maxGainDb ?? 9));

  const resp = await measureFetch(`${baseUrl.replace(/\/$/, '')}/api/match_eq`, {
    method: 'POST',
    body: formData,
  });
  const j = (await resp.json()) as MatchEqResponseBody;
  if (!resp.ok) {
    const msg =
      typeof j.detail === 'string'
        ? j.detail
        : Array.isArray(j.detail)
          ? j.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join('; ')
          : `HTTP ${resp.status}`;
    throw new Error(msg || 'match_eq failed');
  }
  if (!j.file_path || typeof j.file_path !== 'string') {
    throw new Error('match_eq: missing file_path');
  }
  const dur =
    typeof j.duration === 'number' && Number.isFinite(j.duration)
      ? j.duration
      : Number(j.duration);
  if (!Number.isFinite(dur) || dur <= 0) {
    throw new Error('match_eq: invalid duration');
  }
  const num = (v: number | null | undefined) =>
    v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null;
  return {
    file_path: j.file_path,
    duration: dur,
    measured_input_lufs: num(j.measured_input_lufs),
    measured_output_lufs: num(j.measured_output_lufs),
    bands: (j.bands ?? []).map((b) => ({ freq: b.freq, gainDb: b.gain_db })),
  };
}

/** Where a render on the measure server is (`GET /api/render/progress`). */
export interface RenderProgress {
  /** `starting` → `building` (text) → `rendering` (frames) → `combining` → `audio` → `done`. */
  phase: 'starting' | 'building' | 'rendering' | 'combining' | 'audio' | 'done' | 'error' | 'unknown';
  /** 0–100 for the whole render, or null when it cannot be told (scene length unknown). */
  percent: number | null;
  /** Scene seconds written so far, and the scene length the request named. */
  sceneTime?: number;
  duration?: number | null;
  /** Text objects built so far, out of those counted in the scene code. */
  textBuilt?: number;
  textTotal?: number;
}

export interface RenderSceneOptions {
  /** Scene length in seconds; makes the frame-writing part of the percentage possible. */
  expectedDurationSec?: number;
  /** Called with each new progress reading while the render runs. */
  onProgress?: (progress: RenderProgress) => void;
  /** Poll interval in ms (default 700). */
  pollMs?: number;
}

function newRenderJobId(): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `render-${rand}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

async function fetchRenderProgress(base: string, jobId: string): Promise<RenderProgress | null> {
  const resp = await fetch(`${base}/api/render/progress?job_id=${encodeURIComponent(jobId)}`);
  if (!resp.ok) return null;
  const j = (await resp.json()) as {
    phase?: RenderProgress['phase'];
    percent?: number | null;
    scene_time?: number;
    duration?: number | null;
    text_built?: number;
    text_total?: number;
  };
  return {
    phase: j.phase ?? 'unknown',
    percent: typeof j.percent === 'number' ? j.percent : null,
    sceneTime: j.scene_time,
    duration: j.duration,
    textBuilt: j.text_built,
    textTotal: j.text_total,
  };
}

/**
 * Renders Manim scene source on the measure server and returns the MP4 as a Blob.
 * With `onProgress`, polls `/api/render/progress` while the render runs (an older server without
 * that route simply reports nothing).
 */
export async function renderSceneMp4(
  baseUrl: string,
  code: string,
  quality: string,
  sceneName: string,
  masterAudioPath?: string | null,
  opts: RenderSceneOptions = {},
): Promise<Blob> {
  const base = baseUrl.replace(/\/$/, '');
  const jobId = opts.onProgress ? newRenderJobId() : null;
  let polling = jobId !== null;
  const poll = async () => {
    while (polling && jobId) {
      await new Promise((r) => setTimeout(r, opts.pollMs ?? 700));
      if (!polling) break;
      try {
        const p = await fetchRenderProgress(base, jobId);
        if (p === null) break;
        if (polling && p.phase !== 'unknown') opts.onProgress?.(p);
      } catch {
        /* the render request reports real failures */
      }
    }
  };
  const poller = poll();
  let resp: Response;
  try {
    resp = await measureFetch(`${base}/api/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        python_code: code,
        quality,
        scene_name: sceneName,
        master_audio_path: masterAudioPath?.trim() || null,
        ...(jobId ? { job_id: jobId } : {}),
        ...(opts.expectedDurationSec && opts.expectedDurationSec > 0
          ? { expected_duration: Math.min(36000, opts.expectedDurationSec) }
          : {}),
      }),
    });
  } finally {
    polling = false;
  }
  await poller;
  if (!resp.ok) {
    const text = await resp.text();
    let msg = text.trim() || `HTTP ${resp.status}`;
    try {
      const j = JSON.parse(text) as { detail?: string | { msg?: string }[] };
      if (typeof j.detail === 'string') {
        msg = j.detail;
      } else if (Array.isArray(j.detail)) {
        const parts = j.detail.map((d) => d.msg).filter(Boolean);
        if (parts.length) msg = parts.join('; ');
      }
    } catch {
      /* use raw text */
    }
    throw new Error(msg.slice(0, 2000) || 'render failed');
  }
  try {
    return await resp.blob();
  } catch (e) {
    const message =
      e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    throw new Error(
      `${message}\nReading the MP4 response body failed (connection drop or browser blocked).\n${MEASURE_FETCH_HINT}`,
    );
  }
}

/**
 * One frame of a scene at `time` (low-quality Manim render on the measure server, frame grabbed
 * with ffmpeg). Used by the Copilot's `render_manim_frame` tool. Returns PNG base64.
 */
export async function renderSceneFrame(
  baseUrl: string,
  code: string,
  sceneName: string,
  time: number,
  signal?: AbortSignal,
): Promise<{ pngBase64: string; time: number; duration: number | null }> {
  const resp = await measureFetch(`${baseUrl.replace(/\/$/, '')}/api/render_frame`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ python_code: code, scene_name: sceneName, time }),
    signal,
  });
  const text = await resp.text();
  if (!resp.ok) {
    let msg = text.trim() || `HTTP ${resp.status}`;
    try {
      const j = JSON.parse(text) as { detail?: unknown };
      if (typeof j.detail === 'string') msg = j.detail;
    } catch {
      /* use raw text */
    }
    throw new Error(msg.slice(-2000));
  }
  const j = JSON.parse(text) as { png_base64: string; time: number; duration?: number | null };
  return { pngBase64: j.png_base64, time: j.time, duration: j.duration ?? null };
}

/**
 * Concatenate multiple MP4 files on the measure server (ffmpeg; requires ffmpeg on server PATH).
 * Files are joined in the order given.
 */
export async function concatMp4Files(baseUrl: string, files: File[]): Promise<Blob> {
  if (files.length < 2) {
    throw new Error('Select at least two video files to merge.');
  }
  const formData = new FormData();
  for (const f of files) {
    formData.append('files', f);
  }
  const resp = await measureFetch(`${baseUrl.replace(/\/$/, '')}/api/concat_mp4`, {
    method: 'POST',
    body: formData,
  });
  if (!resp.ok) {
    const text = await resp.text();
    let msg = text.trim() || `HTTP ${resp.status}`;
    try {
      const j = JSON.parse(text) as { detail?: string | { msg?: string }[] };
      if (typeof j.detail === 'string') {
        msg = j.detail;
      } else if (Array.isArray(j.detail)) {
        const parts = j.detail.map((d) => d.msg).filter(Boolean);
        if (parts.length) msg = parts.join('; ');
      }
    } catch {
      /* use raw text */
    }
    throw new Error(msg.slice(0, 2000) || 'concat failed');
  }
  try {
    return await resp.blob();
  } catch (e) {
    const message =
      e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    throw new Error(
      `${message}\nReading the merged MP4 failed.\n${MEASURE_FETCH_HINT}`,
    );
  }
}
