import { FRAME_W, FRAME_H } from '@/lib/constants';
import type { CameraPose } from '@/lib/camera';

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

export interface CanvasViewportTransform {
  x: number;
  y: number;
  scale: number;
}

export function cameraViewportTransform(
  pose: CameraPose,
  canvasWidth: number,
  canvasHeight: number,
): CanvasViewportTransform {
  const scale = FRAME_W / pose.width;
  return {
    x: canvasWidth / 2 - pose.x * canvasWidth / pose.width,
    y: canvasHeight / 2 + pose.y * canvasHeight / (pose.width * FRAME_H / FRAME_W),
    scale,
  };
}

export function worldToCanvasPoint(
  world: { x: number; y: number },
  canvasWidth: number,
  canvasHeight: number,
  transform: CanvasViewportTransform,
): { x: number; y: number } {
  const base = manimToCanvas(world.x, world.y, canvasWidth, canvasHeight);
  return {
    x: transform.x + base.x * transform.scale,
    y: transform.y + base.y * transform.scale,
  };
}

export function canvasToWorldPoint(
  canvas: { x: number; y: number },
  canvasWidth: number,
  canvasHeight: number,
  transform: CanvasViewportTransform,
): { x: number; y: number } {
  const baseX = (canvas.x - transform.x) / transform.scale;
  const baseY = (canvas.y - transform.y) / transform.scale;
  return {
    x: (baseX / canvasWidth - 0.5) * FRAME_W,
    y: (0.5 - baseY / canvasHeight) * FRAME_H,
  };
}
