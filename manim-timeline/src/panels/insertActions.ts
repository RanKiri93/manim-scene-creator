import type { KindColorGroup } from '@/lib/theme';

/**
 * Everything the Insert rail can add, in display order. The rail, its flyouts and the labelled
 * sidebar all render from this list so they cannot drift apart. Behaviour (what runs, what the
 * selection allows) lives in `AddObjectToolbar.tsx`; this file is data only.
 */

export type InsertGroupId = 'create' | 'graph' | 'animate' | 'camera' | 'audio';

/** Animate splits by intent: change the object, point at it, or remove it. */
export type InsertSubgroupId = 'change' | 'emphasize' | 'leave';

export type InsertActionId =
  | 'textLine'
  | 'matrix'
  | 'shape'
  | 'image'
  | 'axes'
  | 'graphPlot'
  | 'graphCurve'
  | 'graphDot'
  | 'graphArea'
  | 'graphField'
  | 'graphFunctionSeries'
  | 'graphPointSequence'
  | 'move'
  | 'path'
  | 'graphFollow'
  | 'scale'
  | 'rotate'
  | 'color'
  | 'matrixStep'
  | 'blink'
  | 'surroundingRect'
  | 'exit'
  | 'cameraPan'
  | 'zoomRegion'
  | 'fitObject'
  | 'fullFrame'
  | 'recordAudio'
  | 'uploadAudio'
  | 'textToSpeech';

export interface InsertActionDef {
  id: InsertActionId;
  label: string;
  /** Longer description for the tooltip. Graph actions get the axes hint appended at runtime. */
  title: string;
  group: InsertGroupId;
  subgroup?: InsertSubgroupId;
  /** Other words people use for it, so insert search finds it ("fade" finds Exit). */
  keywords?: string;
}

export interface InsertGroupDef {
  id: InsertGroupId;
  label: string;
  /** Kind color of what the group creates; shown as the flyout swatch. */
  kindGroup: KindColorGroup;
  /** Rail tooltip detail for the category button. */
  summary: string;
  /** Create actions sit directly on the rail; every other group opens a flyout. */
  flyout: boolean;
}

export const INSERT_GROUPS: readonly InsertGroupDef[] = [
  { id: 'create', label: 'Create', kindGroup: 'text', summary: 'Text, matrices, shapes and images', flyout: false },
  { id: 'graph', label: 'Graph', kindGroup: 'graph', summary: 'Axes, plots, curves, dots, areas, fields', flyout: true },
  { id: 'animate', label: 'Animate', kindGroup: 'effect', summary: 'Move, scale, color, blink, exit…', flyout: true },
  { id: 'camera', label: 'Camera', kindGroup: 'camera', summary: 'Pan, zoom and fit the view', flyout: true },
  { id: 'audio', label: 'Audio', kindGroup: 'audio', summary: 'Record, upload or text-to-speech', flyout: true },
];

export const INSERT_SUBGROUP_LABELS: Record<InsertSubgroupId, string> = {
  change: 'Change',
  emphasize: 'Emphasize',
  leave: 'Leave',
};

export const INSERT_ACTIONS: readonly InsertActionDef[] = [
  { id: 'textLine', label: 'Text line', title: 'Text line', group: 'create', keywords: 'hebrew latex math title label words' },
  { id: 'matrix', label: 'Matrix', title: 'Matrix: LaTeX entries in square, round or curly brackets, or bars', group: 'create', keywords: 'matrix vector determinant array bmatrix pmatrix augmented linear algebra' },
  { id: 'shape', label: 'Shape', title: 'Shape: pick one, then draw it on the canvas', group: 'create', keywords: 'circle ellipse rectangle square triangle hexagon polygon arrow double curved line dashed polyline arc sector pie ring annulus brace curly' },
  { id: 'image', label: 'Image', title: 'Image (PNG, JPG, GIF as still picture)', group: 'create', keywords: 'picture photo png jpg gif' },

  { id: 'axes', label: 'Axes', title: 'Axes', group: 'graph', keywords: 'grid coordinate plane number line' },
  { id: 'graphPlot', label: 'Plot', title: 'Graph plot (function y = f(x))', group: 'graph', keywords: 'function graph y=f(x) sin' },
  { id: 'graphCurve', label: 'Curve', title: 'Graph curve (parametric x(t), y(t))', group: 'graph', keywords: 'parametric loop' },
  { id: 'graphDot', label: 'Dot', title: 'Graph dot', group: 'graph', keywords: 'point marker' },
  { id: 'graphArea', label: 'Area', title: 'Graph area (fill under/between)', group: 'graph', keywords: 'fill integral shade region under' },
  { id: 'graphField', label: 'Vector field', title: 'Vector or slope field', group: 'graph', keywords: 'slope arrows vector stream' },
  { id: 'graphFunctionSeries', label: 'Function series', title: 'Function series (partial sums or family f(n,x))', group: 'graph', keywords: 'sum taylor fourier partial family' },
  { id: 'graphPointSequence', label: 'Point sequence', title: 'Point sequence (x(n), y(n))', group: 'graph', keywords: 'sequence limit dots' },

  { id: 'move', label: 'Move', title: 'Persistent move shift (dx/dy)', group: 'animate', subgroup: 'change', keywords: 'shift translate slide' },
  { id: 'path', label: 'Path', title: 'Persistent move along a path (relative offsets)', group: 'animate', subgroup: 'change', keywords: 'trajectory route' },
  { id: 'graphFollow', label: 'Move along graph', title: 'Move the selected graph dot along its same-axes plot', group: 'animate', subgroup: 'change', keywords: 'follow dot along curve trace' },
  { id: 'scale', label: 'Scale', title: 'Persistent scale. Uses compatible selected objects, or the first eligible one.', group: 'animate', subgroup: 'change', keywords: 'grow shrink resize size' },
  { id: 'rotate', label: 'Rotate', title: 'Persistent rotation. Prefers text, shapes and highlights.', group: 'animate', subgroup: 'change', keywords: 'turn spin angle' },
  { id: 'color', label: 'Color', title: 'Persistent color change. Works on the same objects as Blink.', group: 'animate', subgroup: 'change', keywords: 'recolor paint fill colour' },
  { id: 'matrixStep', label: 'Matrix step', title: 'Matrix step: swap, scale or add rows, edit entries, or transpose (selected matrix, or the first one)', group: 'animate', subgroup: 'change', keywords: 'row operation swap scale add gaussian elimination reduce transpose matrix' },
  { id: 'blink', label: 'Blink', title: 'Blink animation (pulse scale/color; does not remove targets)', group: 'animate', subgroup: 'emphasize', keywords: 'highlight flash pulse indicate emphasize' },
  { id: 'surroundingRect', label: 'Surrounding rect', title: 'Surrounding rectangle (select targets or uses first eligible)', group: 'animate', subgroup: 'emphasize', keywords: 'highlight box frame surround emphasize' },
  { id: 'exit', label: 'Exit', title: 'Exit animation (multi-select targets; replaces prior exits on those targets)', group: 'animate', subgroup: 'leave', keywords: 'fade out remove disappear hide uncreate' },

  { id: 'cameraPan', label: 'Pan', title: 'Camera pan to frame', group: 'camera', keywords: 'camera move scroll' },
  { id: 'zoomRegion', label: 'Zoom to region', title: 'Drag a region on the canvas to create a 1-second zoom', group: 'camera', keywords: 'zoom camera magnify' },
  { id: 'fitObject', label: 'Fit object', title: 'Fit the camera to one selected measured object', group: 'camera', keywords: 'zoom camera focus frame' },
  { id: 'fullFrame', label: 'Full frame', title: 'Create an independent 1-second return to the full logical frame', group: 'camera', keywords: 'zoom out reset camera' },

  { id: 'recordAudio', label: 'Record', title: 'Record audio', group: 'audio', keywords: 'mic microphone voice narration' },
  { id: 'uploadAudio', label: 'Upload audio', title: 'Upload audio file', group: 'audio', keywords: 'sound music file mp3 wav' },
  { id: 'textToSpeech', label: 'Text-to-speech', title: 'Text-to-speech', group: 'audio', keywords: 'voice speak narration speech tts' },
];

export function insertActionsInGroup(group: InsertGroupId): InsertActionDef[] {
  return INSERT_ACTIONS.filter((a) => a.group === group);
}

/**
 * Insert search: name matches first (prefix before substring), then keyword matches, in list
 * order within each tier. An empty query returns every action.
 */
export function searchInsertActions(query: string): InsertActionDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...INSERT_ACTIONS];
  const rank = (a: InsertActionDef): number => {
    const label = a.label.toLowerCase();
    if (label.startsWith(q) || label.split(/[\s-]+/).some((w) => w.startsWith(q))) return 0;
    if (label.includes(q)) return 1;
    if (a.keywords?.toLowerCase().split(' ').some((w) => w.startsWith(q))) return 2;
    if (a.keywords?.toLowerCase().includes(q)) return 3;
    return -1;
  };
  return INSERT_ACTIONS.map((a, i) => ({ a, i, r: rank(a) }))
    .filter((x) => x.r >= 0)
    .sort((x, y) => x.r - y.r || x.i - y.i)
    .map((x) => x.a);
}
