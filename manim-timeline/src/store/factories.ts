import { newId } from '@/lib/ids';
import {
  DEFAULT_FONT,
  DEFAULT_FONT_SIZE,
  DEFAULT_MATH_COLOR,
} from '@/lib/constants';
import type {
  TextLineItem,
  GraphItem,
  CompoundItem,
  VoiceoverConfig,
  SegmentStyle,
  GraphFunction,
  GraphDot,
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
    waitAfter: 0.3,
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

export function createCompound(startTime = 0): CompoundItem {
  return {
    id: newId(),
    kind: 'compound',
    label: '',
    layer: 0,
    startTime,
    duration: 6,
    waitAfter: 0.3,
    childIds: [],
    centerHorizontally: true,
  };
}

export function createGraph(
  _defaults: SceneDefaults,
  startTime = 0,
): GraphItem {
  return {
    id: newId(),
    kind: 'graph',
    label: '',
    layer: 0,
    startTime,
    duration: 2,
    x: 0,
    y: 0,
    scale: 1,
    waitAfter: 0.5,
    posSteps: [{ kind: 'absolute' }],
    voice: defaultVoice(),
    xRange: [-5, 5, 1],
    yRange: [-3, 3, 1],
    xLabel: 'x',
    yLabel: 'y',
    includeNumbers: false,
    includeTip: true,
    functions: [],
    dots: [],
    perPartVoice: false,
    voiceAxesScript: '',
    voiceLabelsScript: '',
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
