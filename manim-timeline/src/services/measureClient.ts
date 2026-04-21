import type {
  TextLineItem,
  MeasureResult,
  SegmentStyle,
  SegmentLocalBox,
} from '@/types/scene';

interface MeasureRequestBody {
  tex: string;
  hebrew_font: string | null;
  font_size: number;
  math_font: null;
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
  error?: string;
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
      }))
    : null;

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
  };

  return { result, error: null };
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
  options?: { lang?: string },
): Promise<UploadRecordedAudioResult> {
  const formData = new FormData();
  const safeName = filename.trim() || 'recording.webm';
  formData.append('file', blob, safeName);
  const lang = options?.lang?.trim();
  if (lang) formData.append('lang', lang);
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

/**
 * Renders Manim scene source on the measure server and returns the MP4 as a Blob.
 */
export async function renderSceneMp4(
  baseUrl: string,
  code: string,
  quality: string,
  sceneName: string,
): Promise<Blob> {
  const resp = await measureFetch(`${baseUrl.replace(/\/$/, '')}/api/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      python_code: code,
      quality,
      scene_name: sceneName,
    }),
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
