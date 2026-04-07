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
  CompoundItem,
  ExitAnimationItem,
  VoiceoverConfig,
  SegmentStyle,
  GraphFunction,
  GraphDot,
  GraphStreamPoint,
  SceneDefaults,
  ItemId,
} from '@/types/scene';

function defaultVoice(): VoiceoverConfig {
  return {
    animMode: 'runtime',
    voiceKind: 'tts',
    script: '',
    preamble: '',
    singleTakeBookmarks: true,
    mergeWithNext: false,
    perSegmentNarration: false,
  };
}

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
    voice: defaultVoice(),
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
  targetId: ItemId,
  startTime: number,
  duration = 1,
): ExitAnimationItem {
  return {
    kind: 'exit_animation',
    id: newId(),
    label: '',
    layer: 0,
    startTime,
    duration: Math.max(0.05, duration),
    targetId,
    animStyle: 'fade_out',
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
    voice: defaultVoice(),
    xRange: [-5, 5, 1],
    yRange: [-3, 3, 1],
    xLabel: 'x',
    yLabel: 'y',
    includeNumbers: false,
    includeTip: true,
    perPartVoice: false,
    voiceAxesScript: '',
    voiceLabelsScript: '',
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
    voice: defaultVoice(),
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
    voice: defaultVoice(),
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
    voice: defaultVoice(),
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
    voiceText: '',
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
    voice: defaultVoice(),
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
    voiceText: '',
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
    voiceText: '',
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
    voiceText: '',
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
