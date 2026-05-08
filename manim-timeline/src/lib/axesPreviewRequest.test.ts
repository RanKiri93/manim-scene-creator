import { describe, expect, it } from 'vitest';
import { createAxes, defaultSceneDefaults } from '@/store/factories';
import {
  axesPreviewVisualKey,
  buildAxesPreviewRequestBody,
} from '@/lib/axesPreviewRequest';

describe('axesPreviewRequest', () => {
  it('buildAxesPreviewRequestBody matches visual fields only ordering', () => {
    const ax = createAxes(defaultSceneDefaults(), 0);
    ax.xRange = [-2, 4, 0.5];
    ax.yRange = [1, 5, 1];
    ax.scaleX = 1.2;
    ax.scaleY = 0.9;
    ax.xLabel = 't';
    ax.yLabel = 's';
    ax.includeNumbers = true;
    ax.includeTip = false;
    ax.axisColor = '#abc';
    ax.axisStrokeWidth = 2;
    ax.tickLength = 0.1;
    ax.tickColor = '#def';
    ax.tickStrokeWidth = 1.5;
    ax.numberColor = '#111';
    ax.numberFontSize = 20;
    ax.tipShape = 'StealthTip';
    ax.tipHeight = 0.2;

    const body = buildAxesPreviewRequestBody(ax);
    expect(body.x_range).toEqual([-2, 4, 0.5]);
    expect(body.include_tip).toBe(false);
    expect(body.tip_shape).toBe('StealthTip');
    expect(body.tip_height).toBe(0.2);
    expect(body.axis_color).toBe('#abc');
  });

  it('axesPreviewVisualKey changes when stroke changes', () => {
    const a = createAxes(defaultSceneDefaults(), 0);
    const b = createAxes(defaultSceneDefaults(), 0);
    b.axisStrokeWidth = 3;
    expect(axesPreviewVisualKey(a)).not.toBe(axesPreviewVisualKey(b));
  });

  it('axesPreviewVisualKey ignores timeline fields', () => {
    const a = createAxes(defaultSceneDefaults(), 0);
    const b = createAxes(defaultSceneDefaults(), 0);
    b.startTime = 99;
    b.duration = 0.5;
    b.layer = 7;
    expect(axesPreviewVisualKey(a)).toBe(axesPreviewVisualKey(b));
  });
});
