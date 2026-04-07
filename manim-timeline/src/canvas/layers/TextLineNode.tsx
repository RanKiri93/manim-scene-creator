import { useEffect, useRef, useState } from 'react';
import { Group, Rect, Image as KonvaImage, Text } from 'react-konva';
import type { TextLineItem } from '@/types/scene';
import { useDragSnap } from '@/canvas/hooks/useDragSnap';
import { FRAME_W, FRAME_H } from '@/lib/constants';

interface TextLineNodeProps {
  item: TextLineItem;
  canvasWidth: number;
  canvasHeight: number;
  isSelected: boolean;
  resolvedX: number;
  resolvedY: number;
}

export default function TextLineNode({
  item,
  canvasWidth,
  canvasHeight,
  isSelected,
  resolvedX,
  resolvedY,
}: TextLineNodeProps) {
  const pxPerUnitX = canvasWidth / FRAME_W;
  const pxPerUnitY = canvasHeight / FRAME_H;

  const canvasToManim = (cx: number, cy: number) => ({
    mx: (cx / canvasWidth - 0.5) * FRAME_W,
    my: (0.5 - cy / canvasHeight) * FRAME_H,
  });

  const { onDragStart, onDragMove, onDragEnd, draggable } = useDragSnap({
    itemId: item.id,
    posSteps: item.posSteps,
    canvasToManim,
  });

  // Manim → canvas position using resolved coordinates
  const posX = (resolvedX / FRAME_W + 0.5) * canvasWidth;
  const posY = (0.5 - resolvedY / FRAME_H) * canvasHeight;

  // Determine display size
  const hasMeasure = item.measure && item.measure.widthInk > 0;
  const mW = hasMeasure ? item.measure!.widthInk : 4;
  const mH = hasMeasure ? item.measure!.heightInk : 0.5;
  const pxW = mW * pxPerUnitX * item.scale;
  const pxH = mH * pxPerUnitY * item.scale;

  // Ink offset correction
  const offX = hasMeasure ? item.measure!.offsetInkX * pxPerUnitX : 0;
  const offY = hasMeasure ? -item.measure!.offsetInkY * pxPerUnitY : 0;

  // Load preview image
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!item.previewDataUrl) {
      setImg(null);
      return;
    }
    const el = new window.Image();
    el.onload = () => {
      imgRef.current = el;
      setImg(el);
    };
    el.src = item.previewDataUrl;
    return () => {
      el.onload = null;
    };
  }, [item.previewDataUrl]);

  const displayLabel = item.label || item.raw.slice(0, 30) || '(empty line)';

  return (
    <Group
      x={posX}
      y={posY}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
    >
      {/* Bounding box — amber border when constrained (locked) */}
      <Rect
        x={-pxW / 2 + offX}
        y={-pxH / 2 + offY}
        width={pxW}
        height={pxH}
        stroke={isSelected ? '#3b82f6' : !draggable ? '#d97706' : '#64748b'}
        strokeWidth={isSelected ? 2 : 1}
        dash={!draggable ? [6, 3] : isSelected ? undefined : [4, 4]}
        cornerRadius={2}
      />

      {/* Preview raster (if available) */}
      {img && (
        <KonvaImage
          image={img}
          x={-pxW / 2 + offX}
          y={-pxH / 2 + offY}
          width={pxW}
          height={pxH}
        />
      )}

      {/* Fallback label when no preview */}
      {!img && (
        <Text
          x={-pxW / 2 + offX + 4}
          y={-pxH / 2 + offY + 2}
          text={displayLabel}
          fontSize={11}
          fill="#94a3b8"
          width={pxW - 8}
          ellipsis
          wrap="none"
        />
      )}
    </Group>
  );
}
