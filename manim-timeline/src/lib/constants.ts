import type { VideoFormat } from '@/types/scene';

/** Manim camera frame height in scene units (all formats). */
export const FRAME_H = 8;
/** Frame width of the default 16:9 format (older projects, migrations). */
export const DEFAULT_FRAME_W = 14.222222222222221;

/** Width : height of each video format. */
export const VIDEO_FORMAT_RATIOS: Record<VideoFormat, readonly [number, number]> = {
  '16:9': [16, 9],
  '9:16': [9, 16],
  '1:1': [1, 1],
  '4:5': [4, 5],
};

/** Camera frame width (scene units) for a format: the height stays 8, the width follows the ratio. */
export function frameWidthFor(format: VideoFormat | undefined): number {
  if (!format || format === '16:9') return DEFAULT_FRAME_W;
  const [w, h] = VIDEO_FORMAT_RATIOS[format];
  return (FRAME_H * w) / h;
}

/**
 * Camera frame width of the open project's format. A live binding: `setActiveVideoFormat`
 * (called by the scene store whenever `defaults.videoFormat` changes) updates it for every reader.
 */
export let FRAME_W = DEFAULT_FRAME_W;
let activeFormat: VideoFormat = '16:9';

export function setActiveVideoFormat(format: VideoFormat | undefined): void {
  activeFormat = format ?? '16:9';
  FRAME_W = frameWidthFor(activeFormat);
}

export function activeVideoFormat(): VideoFormat {
  return activeFormat;
}

export const DEFAULT_FONT = 'Alef';
export const DEFAULT_FONT_SIZE = 36;
export const DEFAULT_MATH_COLOR = '#00FFFF';

export const MEASURE_SERVER_DEFAULT_URL = 'http://127.0.0.1:8765';

export const PROJECT_VERSION = 46;

/** Default narration cut fade (ms) when `SceneDefaults.audioCutFadeMs` is unset after migration. */
export const DEFAULT_AUDIO_CUT_FADE_MS = 40;

/** Pixels-per-Manim-unit at a reference canvas width of 1200px */
export const CANVAS_REFERENCE_WIDTH = 1200;

/** Minimum clip duration (seconds) in the timeline */
export const MIN_CLIP_DURATION = 0.01;

/** Debounce delay (ms) before firing a measure request */
export const MEASURE_DEBOUNCE_MS = 550;

/** Timeline zoom presets (seconds visible) */
export const TIMELINE_ZOOM_PRESETS = [5, 10, 15, 30, 60, 120] as const;
