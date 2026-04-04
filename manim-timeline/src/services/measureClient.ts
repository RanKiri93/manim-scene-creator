import type { TextLineItem, MeasureResult, SegmentStyle } from '@/types/scene';

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

  const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/measure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const j: MeasureResponseBody = await resp.json();

  if (!j.ok) {
    return { result: null, error: j.error ?? 'Unknown error' };
  }

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
}

interface GenerateAudioResponseBody {
  audio_base64: string;
  duration: number;
  word_boundaries: { word: string; start: number; end: number }[];
  detail?: string | { msg?: string }[];
}

export async function generateAudio(
  baseUrl: string,
  text: string,
  lang: string,
): Promise<GenerateAudioApiResult> {
  const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/api/generate_audio`, {
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
  return {
    audioBase64: j.audio_base64,
    duration: j.duration,
    boundaries: (j.word_boundaries ?? []).map((w) => ({
      word: w.word,
      start: w.start,
      end: w.end,
    })),
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
): Promise<UploadRecordedAudioResult> {
  const formData = new FormData();
  formData.append('file', blob, 'recording.webm');
  const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/api/upload_audio`, {
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
  const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/api/render`, {
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
  return resp.blob();
}
