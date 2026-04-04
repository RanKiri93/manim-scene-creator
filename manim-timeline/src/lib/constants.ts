/** Default Manim camera frame (16:9 at 1080p) */
export const FRAME_W = 14.222222222222221;
export const FRAME_H = 8;

export const DEFAULT_FONT = 'Alef';
export const DEFAULT_FONT_SIZE = 36;
export const DEFAULT_MATH_COLOR = '#00FFFF';

export const MEASURE_SERVER_DEFAULT_URL = 'http://127.0.0.1:8765';

export const PROJECT_VERSION = 7;

/** Pixels-per-Manim-unit at a reference canvas width of 1200px */
export const CANVAS_REFERENCE_WIDTH = 1200;

/** Minimum clip duration (seconds) in the timeline */
export const MIN_CLIP_DURATION = 0.01;

/** Debounce delay (ms) before firing a measure request */
export const MEASURE_DEBOUNCE_MS = 550;

/** Timeline zoom presets (seconds visible) */
export const TIMELINE_ZOOM_PRESETS = [5, 10, 15, 30, 60, 120] as const;
