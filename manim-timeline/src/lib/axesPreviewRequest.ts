import type { AxesItem } from '@/types/scene';

/** JSON body for `POST /api/preview_axes` (snake_case matches measure server). */
export interface AxesPreviewRequestBody {
  x_range: [number, number, number];
  y_range: [number, number, number];
  scale_x: number;
  scale_y: number;
  x_label: string;
  y_label: string;
  include_numbers: boolean;
  include_tip: boolean;
  axis_color: string | null;
  axis_stroke_width: number | null;
  tick_length: number | null;
  tick_color: string | null;
  tick_stroke_width: number | null;
  number_color: string | null;
  number_font_size: number | null;
  tip_shape: string | null;
  tip_height: number | null;
  tip_width: number | null;
  tip_stroke_width: number | null;
  tip_fill_opacity: number | null;
}

export function buildAxesPreviewRequestBody(item: AxesItem): AxesPreviewRequestBody {
  const tip =
    item.tipShape && item.tipShape !== 'default' ? item.tipShape : null;
  return {
    x_range: [item.xRange[0], item.xRange[1], item.xRange[2]],
    y_range: [item.yRange[0], item.yRange[1], item.yRange[2]],
    scale_x: item.scaleX,
    scale_y: item.scaleY,
    x_label: item.xLabel ?? '',
    y_label: item.yLabel ?? '',
    include_numbers: item.includeNumbers,
    include_tip: item.includeTip,
    axis_color: item.axisColor?.trim() || null,
    axis_stroke_width:
      typeof item.axisStrokeWidth === 'number' &&
      Number.isFinite(item.axisStrokeWidth)
        ? item.axisStrokeWidth
        : null,
    tick_length:
      typeof item.tickLength === 'number' && Number.isFinite(item.tickLength)
        ? item.tickLength
        : null,
    tick_color: item.tickColor?.trim() || null,
    tick_stroke_width:
      typeof item.tickStrokeWidth === 'number' &&
      Number.isFinite(item.tickStrokeWidth)
        ? item.tickStrokeWidth
        : null,
    number_color: item.numberColor?.trim() || null,
    number_font_size:
      typeof item.numberFontSize === 'number' &&
      Number.isFinite(item.numberFontSize)
        ? item.numberFontSize
        : null,
    tip_shape: tip,
    tip_height:
      typeof item.tipHeight === 'number' && Number.isFinite(item.tipHeight)
        ? item.tipHeight
        : null,
    tip_width:
      typeof item.tipWidth === 'number' && Number.isFinite(item.tipWidth)
        ? item.tipWidth
        : null,
    tip_stroke_width:
      typeof item.tipStrokeWidth === 'number' &&
      Number.isFinite(item.tipStrokeWidth)
        ? item.tipStrokeWidth
        : null,
    tip_fill_opacity:
      typeof item.tipFillOpacity === 'number' &&
      Number.isFinite(item.tipFillOpacity)
        ? item.tipFillOpacity
        : null,
  };
}

/** Stable string for change detection and skip logic. */
export function axesPreviewVisualKey(item: AxesItem): string {
  return JSON.stringify(buildAxesPreviewRequestBody(item));
}
