import { newId } from '@/lib/ids';
import {
  DEFAULT_FONT,
  DEFAULT_FONT_SIZE,
  DEFAULT_MATH_COLOR,
} from '@/lib/constants';
import type {
  TextLineItem,
  AxesItem,
  GraphPlotItem,
  GraphDotItem,
  GraphFieldItem,
  GraphSeriesVizItem,
  ShapeItem,
  CompoundItem,
  ExitAnimationItem,
  SurroundingRectItem,
  SegmentStyle,
  GraphFunction,
  GraphDot,
  GraphStreamPoint,
  SceneDefaults,
  ItemId,
} from '@/types/scene';

export function createTextLine(
  defaults: SceneDefaults,
  startTime = 0,
): TextLineItem {
  return {
    id: newId(),
    kind: 'textLine',
    label: '',
    layer: 0,
    startTime,
    duration: 3,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    audioTrackId: null,
    raw: '',
    font: defaults.font,
    fontSize: defaults.fontSize,
    segments: [],
    measure: null,
    measureError: null,
    previewDataUrl: null,
    parentId: null,
  };
}

/** Text line inside a compound; timing is local to the compound start. */
export function createTextLineInCompound(
  defaults: SceneDefaults,
  compoundId: ItemId,
  localStart: number,
  localDuration = 3,
): TextLineItem {
  const line = createTextLine(defaults, 0);
  line.parentId = compoundId;
  line.localStart = localStart;
  line.localDuration = localDuration;
  line.startTime = 0;
  line.duration = localDuration;
  return line;
}

export function createExitAnimation(
  targetIds: ItemId[],
  startTime: number,
  duration = 1,
): ExitAnimationItem {
  const ids = targetIds.length > 0 ? targetIds : [];
  if (ids.length === 0) {
    throw new Error('createExitAnimation requires at least one target id');
  }
  return {
    kind: 'exit_animation',
    id: newId(),
    label: '',
    layer: 0,
    startTime,
    duration: Math.max(0.05, duration),
    targets: ids.map((targetId) => ({
      targetId,
      animStyle: 'fade_out' as const,
    })),
  };
}

export function createSurroundingRect(
  targetId: ItemId,
  startTime = 0,
): SurroundingRectItem {
  return {
    kind: 'surroundingRect',
    id: newId(),
    label: '',
    layer: 0,
    startTime,
    duration: 2,
    targetId,
    segmentIndices: null,
    buff: 0.15,
    color: '#fbbf24',
    cornerRadius: 0.08,
    strokeWidth: 2,
    labelText: '',
    labelDir: 'UP',
    labelFontSize: 22,
    introStyle: 'create',
    introRunTime: 0.45,
  };
}

export function createCompound(startTime = 0): CompoundItem {
  return {
    id: newId(),
    kind: 'compound',
    label: '',
    layer: 0,
    startTime,
    duration: 6,
    childIds: [],
    centerHorizontally: true,
  };
}

export function createShape(startTime = 0): ShapeItem {
  return {
    id: newId(),
    kind: 'shape',
    label: '',
    layer: 0,
    startTime,
    duration: 2,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    audioTrackId: null,
    shapeType: 'circle',
    rotationDeg: 0,
    radius: 0.5,
    width: 2,
    height: 1,
    endX: 2,
    endY: 0,
    strokeColor: '#60a5fa',
    strokeWidth: 3,
    fillColor: null,
    fillOpacity: 0.25,
    introStyle: 'create',
  };
}

export function createAxes(
  _defaults: SceneDefaults,
  startTime = 0,
): AxesItem {
  return {
    id: newId(),
    kind: 'axes',
    label: '',
    layer: 0,
    startTime,
    duration: 2,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    audioTrackId: null,
    xRange: [-5, 5, 1],
    yRange: [-3, 3, 1],
    xLabel: 'x',
    yLabel: 'y',
    includeNumbers: false,
    includeTip: true,
  };
}

export function createGraphPlot(
  axesId: ItemId,
  startTime = 0,
): GraphPlotItem {
  return {
    id: newId(),
    kind: 'graphPlot',
    label: '',
    layer: 0,
    startTime,
    duration: 1,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    audioTrackId: null,
    axesId,
    fn: createGraphFunction(),
  };
}

export function createGraphDotItem(
  axesId: ItemId,
  startTime = 0,
): GraphDotItem {
  return {
    id: newId(),
    kind: 'graphDot',
    label: '',
    layer: 0,
    startTime,
    duration: 1,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    audioTrackId: null,
    axesId,
    dot: createGraphDot(),
  };
}

export function createGraphSeriesViz(
  axesId: ItemId,
  startTime = 0,
): GraphSeriesVizItem {
  return {
    id: newId(),
    kind: 'graphSeriesViz',
    label: '',
    layer: 0,
    startTime,
    duration: 4,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    audioTrackId: null,
    axesId,
    vizMode: 'series',
    nMin: 1,
    nMax: 30,
    nMapping: 'linear_smooth',
    nEasing: 'ease_out',
    jsExpr: '1/n',
    pyExpr: '1/n',
    ghostCount: 6,
    ghostOpacityMin: 0.12,
    ghostOpacityMax: 0.45,
    showHeadDot: true,
    strokeColor: '#f97316',
    headColor: '#fde047',
    strokeWidth: 2.5,
    limitY: null,
  };
}

export function createGraphFieldItem(
  axesId: ItemId,
  startTime = 0,
): GraphFieldItem {
  return {
    id: newId(),
    kind: 'graphField',
    label: '',
    layer: 0,
    startTime,
    duration: 2,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    audioTrackId: null,
    axesId,
    fieldMode: 'vector',
    pyExprSlope: '0',
    jsExprSlope: '0',
    slopeArrowLength: 0.5,
    pyExprP: '1',
    pyExprQ: '0',
    jsExprP: '1',
    jsExprQ: '0',
    fieldGridStep: 0.5,
    fieldColormap: 'viridis',
    colorSchemeMin: 0,
    colorSchemeMax: 2,
    streamPoints: [],
    streamPlacementActive: false,
    streamDt: 0.05,
    streamVirtualTime: 3,
  };
}

export function createGraphStreamPoint(): GraphStreamPoint {
  return {
    id: newId(),
    x: 0,
    y: 0,
  };
}

export function createGraphFunction(): GraphFunction {
  return {
    id: newId(),
    jsExpr: 'Math.sin(x)',
    pyExpr: 'np.sin(x)',
    color: '#3b82f6',
    label: '',
  };
}

export function createGraphDot(): GraphDot {
  return {
    id: newId(),
    dx: 0,
    dy: 0,
    color: '#ef4444',
    radius: 0.08,
    label: '',
    labelDir: 'UP',
  };
}

export function createSegmentStyle(
  text: string,
  isMath: boolean,
  defaults: SceneDefaults,
): SegmentStyle {
  return {
    text,
    isMath,
    color: isMath ? defaults.mathColor : '#ffffff',
    bold: false,
    italic: false,
  };
}

export function defaultSceneDefaults(): SceneDefaults {
  return {
    font: DEFAULT_FONT,
    fontSize: DEFAULT_FONT_SIZE,
    mathColor: DEFAULT_MATH_COLOR,
    exportNamePrefix: '',
    sceneName: 'Scene1',
  };
}
