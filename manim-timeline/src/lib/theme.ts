import type { SceneItem } from '@/types/scene';

/**
 * Chalkboard theme colors for code that cannot use Tailwind classes (Konva layers, inline SVG,
 * canvas drawing). Mirrors the `@theme` block in `src/index.css`; `theme.test.ts` fails if a
 * value here drifts from the CSS. Usage rules: `.agents/skills/ui-design-system/SKILL.md`.
 */
export const THEME = {
  ink: '#1a1916',
  panel: '#211f1c',
  raised: '#2b2925',
  rule: '#3a3732',
  chalk: '#ece6d6',
  chalkDim: '#aba493',
  chalkFaint: '#999383',
  stage: '#000000',
  highlight: '#f7d96f',
  highlightInk: '#1a1916',
  danger: '#fc6255',
  warn: '#f0ac5f',
} as const;

/** One color per item group, taken from Manim's color constants (WHITE, GREEN_C, BLUE_C, ...). */
export const KIND_COLORS = {
  text: '#ece6d6',
  axes: '#83c167',
  graph: '#58c4dd',
  shape: '#5cd0b3',
  camera: '#c96579', // MAROON_C (#c55f73) lifted slightly so clip labels clear 4.5:1
  audio: '#9a72ac',
  image: '#f0ac5f',
  effect: '#888888',
} as const;

export type KindColorGroup = keyof typeof KIND_COLORS;

/**
 * Editor-only marks drawn on the Konva stage: selection, handles, grid, frame outlines, guides.
 * Never use these for colors that preview Manim output (item colors, default axes/plot colors).
 * Konva accepts 8-digit hex, so translucent variants append an alpha byte.
 */
export const CANVAS_CHROME = {
  selection: THEME.highlight,
  /** Locked / preview-only (amber in the old palette). */
  locked: THEME.warn,
  idleOutline: `${THEME.chalkFaint}99`,
  error: THEME.danger,
  label: THEME.chalkDim,
  gridMinor: THEME.chalkFaint,
  gridMajor: THEME.chalkDim,
  guide: THEME.highlight,
  regionFill: `${THEME.highlight}22`,
  placeholderFill: `${THEME.chalkFaint}26`,
  handleFill: THEME.chalk,
  handleStroke: THEME.ink,
  gripFill: THEME.panel,
  gripIdle: THEME.rule,
  gripLines: THEME.chalkDim,
} as const;

/** Exhaustive: adding a `SceneItem` kind is a type error until it is given a color group here. */
export const ITEM_COLOR_GROUP: Record<SceneItem['kind'], KindColorGroup> = {
  textLine: 'text',
  axes: 'axes',
  graphPlot: 'graph',
  graphCurve: 'graph',
  graphDot: 'graph',
  graphArea: 'graph',
  graphField: 'graph',
  graphFunctionSeries: 'graph',
  graphPointSequence: 'graph',
  shape: 'shape',
  surroundingRect: 'shape',
  image: 'image',
  camera_move: 'camera',
  exit_animation: 'effect',
  blink_animation: 'effect',
  target_animation: 'effect',
};

export function itemKindColor(kind: SceneItem['kind']): string {
  return KIND_COLORS[ITEM_COLOR_GROUP[kind]];
}
