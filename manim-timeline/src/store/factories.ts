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
  GraphCurveItem,
  GraphDotItem,
  GraphFieldItem,
  GraphFunctionSeriesItem,
  GraphPointSequenceItem,
  GraphAreaItem,
  ShapeItem,
  ExitAnimationItem,
  BlinkAnimationItem,
  CameraMoveItem,
  FrameDef,
  TargetAnimationItem,
  TargetAnimationMode,
  SurroundingRectItem,
  SegmentStyle,
  GraphFunction,
  GraphParametricCurve,
  GraphDot,
  GraphStreamPoint,
  SceneDefaults,
  ItemId,
} from '@/types/scene';
import { createDefaultFrame } from '@/lib/frameGrid';
import {
  DEFAULT_FIELD_ARROW_STROKE_WIDTH,
  functionSeriesTotalDuration,
  pointSequenceTotalDuration,
  DEFAULT_SHAPE_POLYLINE_POINTS,
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
    segmentMeasures: null,
    mathChildMeasures: null,
  };
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

export function createBlinkAnimation(
  targetIds: ItemId[],
  startTime: number,
  duration = 0.6,
): BlinkAnimationItem {
  const ids = targetIds.length > 0 ? targetIds : [];
  if (ids.length === 0) {
    throw new Error('createBlinkAnimation requires at least one target id');
  }
  return {
    kind: 'blink_animation',
    id: newId(),
    label: '',
    layer: 0,
    startTime,
    duration: Math.max(0.05, duration),
    repetitions: 1,
    targets: ids.map((targetId) => ({
      targetId,
      mode: 'scale' as const,
      scaleFactor: 1.15,
      blinkColor: '#fbbf24',
    })),
  };
}

export function createFrame(col = 0, row = 0, label?: string): FrameDef {
  return {
    ...createDefaultFrame(),
    col,
    row,
    label,
  };
}

export function defaultFrames(): { frames: FrameDef[]; startFrameId: ItemId } {
  const frame = createDefaultFrame();
  return { frames: [frame], startFrameId: frame.id };
}

export function createCameraMove(
  targetFrameId: ItemId,
  startTime: number,
  duration = 1,
): CameraMoveItem {
  return {
    kind: 'camera_move',
    id: newId(),
    label: '',
    layer: 0,
    startTime,
    duration: Math.max(0.05, duration),
    targetFrameId,
    offsetX: 0,
    offsetY: 0,
  };
}

export function defaultTargetAnimationRow(mode: TargetAnimationMode, targetId: ItemId) {
  switch (mode) {
    case 'scale':
      return { targetId, scaleFactor: 1.25 };
    case 'color':
      return { targetId, color: '#38bdf8' };
    case 'move':
      return { targetId, dx: 0.5, dy: 0.15 };
    case 'path':
      return {
        targetId,
        pathKind: 'polyline' as const,
        pathPoints: [
          { x: 0, y: 0 },
          { x: 0.6, y: 0 },
          { x: 0.6, y: 0.4 },
        ],
        parametricPath: {
          jsXExpr: 'Math.cos(t)',
          jsYExpr: 'Math.sin(t)',
          pyXExpr: 'np.cos(t)',
          pyYExpr: 'np.sin(t)',
          tMin: 0,
          tMax: Math.PI * 2,
          samples: 80,
        },
      };
    case 'rotate':
      return { targetId, angleDeg: 45 };
    default:
      return { targetId };
  }
}

export function createTargetAnimation(
  mode: TargetAnimationMode,
  targetIds: ItemId[],
  startTime: number,
  duration = 1,
): TargetAnimationItem {
  const ids = targetIds.length > 0 ? targetIds : [];
  if (ids.length === 0) {
    throw new Error('createTargetAnimation requires at least one target id');
  }
  return {
    kind: 'target_animation',
    id: newId(),
    label: '',
    layer: 0,
    startTime,
    duration: Math.max(0.05, duration),
    mode,
    targets: ids.map((id) => defaultTargetAnimationRow(mode, id)),
  };
}

export function createSurroundingRect(
  targetIds: ItemId[],
  startTime = 0,
): SurroundingRectItem {
  return {
    kind: 'surroundingRect',
    id: newId(),
    label: '',
    layer: 0,
    startTime,
    runTime: 0.45,
    targetIds: [...targetIds],
    segmentIndices: null,
    buff: 0.15,
    color: '#fbbf24',
    cornerRadius: 0.08,
    strokeWidth: 2,
    labelText: '',
    labelDir: 'UP',
    labelFontSize: 22,
    introStyle: 'create',
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
    points: [...DEFAULT_SHAPE_POLYLINE_POINTS],
    tailArrow: false,
    headArrow: false,
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
    scaleX: 1,
    scaleY: 1,
    posSteps: [{ kind: 'absolute' }],
    audioTrackId: null,
    xRange: [-5, 5, 1],
    yRange: [-3, 3, 1],
    xLabel: 'x',
    yLabel: 'y',
    includeNumbers: false,
    includeTip: true,
    axisColor: undefined,
    axisStrokeWidth: undefined,
    tickLength: undefined,
    tickColor: undefined,
    tickStrokeWidth: undefined,
    numberColor: undefined,
    numberFontSize: undefined,
    tipShape: undefined,
    tipHeight: undefined,
    tipWidth: undefined,
    tipStrokeWidth: undefined,
    tipFillOpacity: undefined,
    tipLength: undefined,
    axisPreviewDataUrl: null,
    axisPreviewError: null,
    axisPreviewHash: null,
    axisPreviewBounds: null,
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
    xDomain: null,
    strokeWidth: 2,
    lineStyle: 'solid',
  };
}

export function createGraphParametricCurve(): GraphParametricCurve {
  return {
    id: newId(),
    jsXExpr: 'Math.cos(t)',
    jsYExpr: 'Math.sin(t)',
    pyXExpr: 'np.cos(t)',
    pyYExpr: 'np.sin(t)',
    color: '#3b82f6',
    label: '',
  };
}

export function createGraphCurve(
  axesId: ItemId,
  startTime = 0,
): GraphCurveItem {
  return {
    id: newId(),
    kind: 'graphCurve',
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
    curve: createGraphParametricCurve(),
    tDomain: [0, 2 * Math.PI],
    strokeWidth: 2,
    lineStyle: 'solid',
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

export function createGraphFunctionSeries(
  axesId: ItemId,
  startTime = 0,
): GraphFunctionSeriesItem {
  const base: GraphFunctionSeriesItem = {
    id: newId(),
    kind: 'graphFunctionSeries',
    label: '',
    layer: 0,
    startTime,
    duration: 0,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    audioTrackId: null,
    axesId,
    jsExpr: 'Math.sin(n * x)',
    pyExpr: 'np.sin(n * x)',
    nMin: 1,
    nMax: 5,
    mode: 'accumulation',
    displayMode: 'individual',
    xDomain: null,
    defaults: {
      color: '#3b82f6',
      strokeWidth: 4,
      lineStyle: 'solid',
      animDuration: 1,
      waitAfter: 0.3,
    },
    perN: {},
    perNErrors: {},
    topLevelError: null,
  };
  base.duration = Math.max(0.01, functionSeriesTotalDuration(base));
  return base;
}

export function createGraphPointSequence(
  axesId: ItemId,
  startTime = 0,
): GraphPointSequenceItem {
  const base: GraphPointSequenceItem = {
    id: newId(),
    kind: 'graphPointSequence',
    label: '',
    layer: 0,
    startTime,
    duration: 0,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    audioTrackId: null,
    axesId,
    jsXExpr: 'n',
    jsYExpr: '0',
    pyXExpr: 'n',
    pyYExpr: '0',
    nMin: 1,
    nMax: 5,
    mode: 'accumulation',
    defaults: {
      color: '#3b82f6',
      pointRadius: 0.08,
      animDuration: 0.6,
      waitAfter: 0.2,
    },
    perN: {},
    perNErrors: {},
    topLevelError: null,
  };
  base.duration = Math.max(0.01, pointSequenceTotalDuration(base));
  return base;
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
    arrowStrokeWidth: DEFAULT_FIELD_ARROW_STROKE_WIDTH,
    streamPoints: [],
    streamPlacementActive: false,
    streamDt: 0.05,
    streamVirtualTime: 3,
  };
}

export function createGraphArea(axesId: ItemId, startTime = 0): GraphAreaItem {
  return {
    id: newId(),
    kind: 'graphArea',
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
    mode: {
      areaKind: 'underCurve',
      xMin: -1,
      xMax: 1,
      curve: { sourceKind: 'expr', jsExpr: '0', pyExpr: '0' },
      showBoundaryPlot: false,
    },
    fillColor: '#3b82f6',
    fillOpacity: 0.35,
    strokeColor: '#1e40af',
    strokeWidth: 0,
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
