import { describe, expect, it } from 'vitest';
import type {
  AxesItem,
  SceneDefaults,
  SceneItem,
  TextLineItem,
} from '@/types/scene';
import { buildContextPayload, stripUiFields } from './serialize';

function defaults(): SceneDefaults {
  return {
    font: 'Arial',
    fontSize: 32,
    mathColor: '#ffffff',
    exportNamePrefix: '',
    sceneName: 'Scene1',
  };
}

function textLine(): TextLineItem {
  return {
    id: 'tl1',
    kind: 'textLine',
    label: '',
    layer: 0,
    startTime: 0,
    duration: 3,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    audioTrackId: null,
    raw: 'hello',
    font: 'Arial',
    fontSize: 32,
    segments: [],
    measure: {
      width: 1,
      height: 1,
      widthInk: 1,
      heightInk: 1,
      offsetInkX: 0,
      offsetInkY: 0,
      inkLeftX: 0,
      inkRightX: 0,
      inkTopY: 0,
      inkBottomY: 0,
      bboxLeft: 0,
      bboxRight: 0,
      bboxTop: 0,
      bboxBottom: 0,
      pngBase64: 'AAA',
      pngWidth: 10,
      pngHeight: 10,
      segmentMeasures: null,
      mathChildMeasures: null,
    },
    measureError: null,
    previewDataUrl: 'data:image/png;base64,AAA',
    segmentMeasures: null,
    mathChildMeasures: null,
  };
}

function axes(): AxesItem {
  return {
    id: 'ax1',
    kind: 'axes',
    label: '',
    layer: 0,
    startTime: 0,
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
    axisPreviewDataUrl: 'data:image/png;base64,AAA',
    axisPreviewError: null,
    axisPreviewHash: 'h1',
    axisPreviewBounds: {
      left: -1,
      right: 1,
      top: 1,
      bottom: -1,
      offsetInkX: 0,
      offsetInkY: 0,
    },
  };
}

describe('stripUiFields', () => {
  it('removes measure, previewDataUrl, segmentMeasures, mathChildMeasures, measureError on textLine', () => {
    const slim = stripUiFields(textLine()) as Record<string, unknown>;
    expect(slim.measure).toBeUndefined();
    expect(slim.previewDataUrl).toBeUndefined();
    expect(slim.segmentMeasures).toBeUndefined();
    expect(slim.mathChildMeasures).toBeUndefined();
    expect(slim.measureError).toBeUndefined();
    expect(slim.raw).toBe('hello');
    expect(slim.id).toBe('tl1');
  });

  it('leaves non-textLine items mostly untouched', () => {
    const slim = stripUiFields(axes()) as Record<string, unknown>;
    expect(slim.kind).toBe('axes');
    expect(slim.xRange).toEqual([-5, 5, 1]);
    expect(slim.axisPreviewDataUrl).toBeUndefined();
    expect(slim.axisPreviewHash).toBeUndefined();
    expect(slim.axisPreviewBounds).toBeUndefined();
  });
});

describe('buildContextPayload', () => {
  it('serializes defaults, currentTime, and strips items', () => {
    const map = new Map<string, SceneItem>();
    map.set('tl1', textLine());
    map.set('ax1', axes());
    const payload = buildContextPayload({
      defaults: defaults(),
      currentTime: 4.2,
      items: map,
    });
    expect(payload.currentTimeSec).toBe(4.2);
    expect(payload.projectDefaults.sceneName).toBe('Scene1');
    expect(payload.existingItems).toHaveLength(2);
    for (const it of payload.existingItems) {
      const rec = it as Record<string, unknown>;
      expect(rec.measure).toBeUndefined();
      expect(rec.previewDataUrl).toBeUndefined();
    }
  });

  it('returns a shallow copy of defaults so caller can mutate safely', () => {
    const d = defaults();
    const payload = buildContextPayload({
      defaults: d,
      currentTime: 0,
      items: new Map(),
    });
    d.sceneName = 'Other';
    expect(payload.projectDefaults.sceneName).toBe('Scene1');
  });
});
