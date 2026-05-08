import { FRAME_W, FRAME_H } from '@/lib/constants';

/** Canvas pixel position for a Manim-space point (matches GraphNode / TextLineNode). */
export function manimToCanvas(
  mx: number,
  my: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  return {
    x: (mx / FRAME_W + 0.5) * canvasWidth,
    y: (0.5 - my / FRAME_H) * canvasHeight,
  };
}

/** Center of a surrounding-rect AABB in canvas pixels (matches SurroundingRectNode corners). */
export function surroundBBoxCanvasCenter(
  bbox: { left: number; right: number; bottom: number; top: number },
  cw: number,
  ch: number,
): { x: number; y: number } {
  const x1 = (bbox.left / FRAME_W + 0.5) * cw;
  const x2 = (bbox.right / FRAME_W + 0.5) * cw;
  const yTop = (0.5 - bbox.top / FRAME_H) * ch;
  const yBot = (0.5 - bbox.bottom / FRAME_H) * ch;
  const x = Math.min(x1, x2);
  const y = Math.min(yTop, yBot);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(yBot - yTop);
  return { x: x + w / 2, y: y + h / 2 };
}

/**
 * Apply Konva-style anchored scale: pivot (ax,ay), scale s, point (px,py) in stage space.
 * Used to validate the PlaybackWrap transform algebra.
 */
export function anchoredScalePoint(
  px: number,
  py: number,
  ax: number,
  ay: number,
  s: number,
): { x: number; y: number } {
  return {
    x: ax + s * (px - ax),
    y: ay + s * (py - ay),
  };
}
