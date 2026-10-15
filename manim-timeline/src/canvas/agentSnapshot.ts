import type Konva from 'konva';
import type { CameraPose } from '@/lib/camera';
import { FRAME_H, FRAME_W } from '@/lib/constants';
import { worldToCanvasPoint, type CanvasViewportTransform } from '@/lib/canvasManimCoords';

/** Stage-pixel rectangle the camera sees, under the stage's current content transform. */
export function cameraCropRect(
  pose: CameraPose,
  canvasWidth: number,
  canvasHeight: number,
  transform: CanvasViewportTransform,
): { x: number; y: number; width: number; height: number } {
  const halfW = pose.width / 2;
  const halfH = (pose.width * FRAME_H) / FRAME_W / 2;
  const topLeft = worldToCanvasPoint({ x: pose.x - halfW, y: pose.y + halfH }, canvasWidth, canvasHeight, transform);
  const bottomRight = worldToCanvasPoint({ x: pose.x + halfW, y: pose.y - halfH }, canvasWidth, canvasHeight, transform);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: Math.max(1, bottomRight.x - topLeft.x),
    height: Math.max(1, bottomRight.y - topLeft.y),
  };
}

/** Width of the picture sent to the model. */
export const SNAPSHOT_WIDTH_PX = 960;

/**
 * PNG (base64, no prefix) of the stage inside `rect`, scaled to about {@link SNAPSHOT_WIDTH_PX}
 * wide, on Manim's black background.
 */
export function captureStageRect(
  stage: Konva.Stage,
  rect: { x: number; y: number; width: number; height: number },
): string {
  const pixelRatio = Math.max(0.25, Math.min(4, SNAPSHOT_WIDTH_PX / rect.width));
  const drawn = stage.toCanvas({ ...rect, pixelRatio });
  const out = document.createElement('canvas');
  out.width = drawn.width;
  out.height = drawn.height;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas context for the snapshot.');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(drawn, 0, 0);
  return out.toDataURL('image/png').split(',')[1] ?? '';
}

export function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/**
 * Run `capture` with proposed items drawn as they will look once applied: the preview fades
 * proposals (wrapper groups `scene-item-*` below full opacity) and dims deletions. The editor
 * grid layer is hidden.
 */
export function withProposalsAsFinal<T>(stage: Konva.Stage, capture: () => T): T {
  const restore: [Konva.Node, number][] = [];
  // The editor grid is not part of the video.
  for (const grid of stage.find('.editor-grid')) {
    restore.push([grid, grid.opacity()]);
    grid.opacity(0);
  }
  for (const node of stage.find((n: Konva.Node) => n.id().startsWith('scene-item-'))) {
    const opacity = node.opacity();
    if (opacity >= 1) continue;
    restore.push([node, opacity]);
    node.opacity(opacity <= 0.3 ? 0 : 1);
  }
  try {
    return capture();
  } finally {
    for (const [node, opacity] of restore) node.opacity(opacity);
  }
}
