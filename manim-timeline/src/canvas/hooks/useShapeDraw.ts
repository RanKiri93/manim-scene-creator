import type { ShapeDrawPreset } from '@/lib/shapeDraw';

/** The Shape picker asks the canvas to start drawing (detail: the preset). */
export const SHAPE_DRAW_REQUEST_EVENT = 'manim-timeline:shape-draw-request';

export function requestShapeDraw(preset: ShapeDrawPreset): void {
  window.dispatchEvent(new CustomEvent<ShapeDrawPreset>(SHAPE_DRAW_REQUEST_EVENT, { detail: preset }));
}
