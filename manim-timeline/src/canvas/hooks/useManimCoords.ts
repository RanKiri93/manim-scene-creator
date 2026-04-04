import { useCallback } from 'react';
import { FRAME_W, FRAME_H } from '@/lib/constants';

/**
 * Convert between Manim scene coordinates and Konva canvas pixel coordinates.
 * Manim: origin at center, +x right, +y up.
 * Canvas: origin at top-left, +x right, +y down.
 */
export function useManimCoords(canvasWidth: number, canvasHeight: number) {
  const pxPerUnitX = canvasWidth / FRAME_W;
  const pxPerUnitY = canvasHeight / FRAME_H;

  const manimToCanvas = useCallback(
    (mx: number, my: number) => ({
      cx: (mx / FRAME_W + 0.5) * canvasWidth,
      cy: (0.5 - my / FRAME_H) * canvasHeight,
    }),
    [canvasWidth, canvasHeight],
  );

  const canvasToManim = useCallback(
    (cx: number, cy: number) => ({
      mx: (cx / canvasWidth - 0.5) * FRAME_W,
      my: (0.5 - cy / canvasHeight) * FRAME_H,
    }),
    [canvasWidth, canvasHeight],
  );

  const manimSizeToPx = useCallback(
    (mw: number, mh: number) => ({
      pw: mw * pxPerUnitX,
      ph: mh * pxPerUnitY,
    }),
    [pxPerUnitX, pxPerUnitY],
  );

  return { manimToCanvas, canvasToManim, manimSizeToPx, pxPerUnitX, pxPerUnitY };
}
