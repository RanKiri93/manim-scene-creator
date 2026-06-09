import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Group, Rect, Image as KonvaImage, Text } from 'react-konva';
import type {
  AudioTrackItem,
  ItemId,
  SceneItem,
  SegmentLocalBox,
  TextLineItem,
} from '@/types/scene';
import { resolveTextBlinkPieces } from '@/lib/blinkTextTargets';
import { useDragSnap } from '@/canvas/hooks/useDragSnap';
import { FRAME_W, FRAME_H } from '@/lib/constants';
import {
  textIntroFinished,
  textIntroSegmentStates,
  type BlinkPreviewState,
  type TextTransformPreviewState,
} from '@/lib/visualPlaybackPreview';

export interface TextTransformLinePreview extends TextTransformPreviewState {
  sourceResolvedX: number;
  sourceResolvedY: number;
  targetResolvedX: number;
  targetResolvedY: number;
}

interface TextLineNodeProps {
  item: TextLineItem;
  canvasWidth: number;
  canvasHeight: number;
  isSelected: boolean;
  resolvedX: number;
  resolvedY: number;
  frameOffset: { x: number; y: number };
  currentTime: number;
  itemsMap: Map<ItemId, SceneItem>;
  audioItems: AudioTrackItem[];
  transformPreview: TextTransformLinePreview | null;
  blinkPreview: BlinkPreviewState | null;
}

interface ImageGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  inkLeft: number;
  inkTop: number;
  inkWidth: number;
  inkHeight: number;
}

interface SegmentImageRect {
  x: number;
  y: number;
  width: number;
  height: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  centerX: number;
  centerY: number;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function canRenderSegments(
  item: TextLineItem,
  img: HTMLImageElement | null,
): img is HTMLImageElement {
  return Boolean(
    img &&
      item.measure &&
      item.measure.widthInk > 0 &&
      item.measure.heightInk > 0 &&
      item.segmentMeasures &&
      item.segmentMeasures.length > 0,
  );
}

function segmentBoxForIndex(
  item: TextLineItem,
  index: number,
): SegmentLocalBox | null {
  return item.segmentMeasures?.[index] ?? null;
}

function segmentRevealDirection(
  item: TextLineItem,
  index: number,
): 'ltr' | 'rtl' {
  const measuredKind = item.segmentMeasures?.[index]?.isMath;
  if (typeof measuredKind === 'boolean') return measuredKind ? 'ltr' : 'rtl';
  return item.segments[index]?.isMath ? 'ltr' : 'rtl';
}

function segmentRect(
  box: SegmentLocalBox,
  geom: ImageGeometry,
  img: HTMLImageElement,
): SegmentImageRect {
  const left = box.cx - box.w / 2;
  const right = box.cx + box.w / 2;
  const top = box.cy + box.h / 2;
  const bottom = box.cy - box.h / 2;

  const fx0 = clamp01((left - geom.inkLeft) / geom.inkWidth);
  const fx1 = clamp01((right - geom.inkLeft) / geom.inkWidth);
  const fy0 = clamp01((geom.inkTop - top) / geom.inkHeight);
  const fy1 = clamp01((geom.inkTop - bottom) / geom.inkHeight);

  const x = geom.x + fx0 * geom.width;
  const y = geom.y + fy0 * geom.height;
  const width = Math.max(0.5, (fx1 - fx0) * geom.width);
  const height = Math.max(0.5, (fy1 - fy0) * geom.height);

  return {
    x,
    y,
    width,
    height,
    cropX: fx0 * img.naturalWidth,
    cropY: fy0 * img.naturalHeight,
    cropWidth: Math.max(1, (fx1 - fx0) * img.naturalWidth),
    cropHeight: Math.max(1, (fy1 - fy0) * img.naturalHeight),
    centerX: x + width / 2,
    centerY: y + height / 2,
  };
}

function renderSegmentImage(
  img: HTMLImageElement,
  rect: SegmentImageRect,
  key: string,
  opacity: number,
  writeProgress = 1,
  revealDirection: 'ltr' | 'rtl' = 'rtl',
  dx = 0,
  dy = 0,
) {
  const p = clamp01(writeProgress);
  if (opacity <= 0 || p <= 0 || rect.width <= 0 || rect.height <= 0) return null;
  const w = rect.width * p;
  const cropW = rect.cropWidth * p;
  // Hebrew text writes visually right-to-left, but math segments should reveal
  // left-to-right to match the direction users expect for formulas.
  const x = revealDirection === 'rtl' ? rect.x + rect.width - w : rect.x;
  const cropX =
    revealDirection === 'rtl' ? rect.cropX + rect.cropWidth - cropW : rect.cropX;
  return (
    <KonvaImage
      key={key}
      image={img}
      x={x + dx}
      y={rect.y + dy}
      width={w}
      height={rect.height}
      crop={{
        x: cropX,
        y: rect.cropY,
        width: cropW,
        height: rect.cropHeight,
      }}
      opacity={opacity}
      listening={false}
    />
  );
}

function renderCroppedImage(
  img: HTMLImageElement,
  rect: SegmentImageRect,
  key: string,
  opacity = 1,
) {
  return (
    <KonvaImage
      key={key}
      image={img}
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      crop={{
        x: rect.cropX,
        y: rect.cropY,
        width: rect.cropWidth,
        height: rect.cropHeight,
      }}
      opacity={opacity}
      listening={false}
    />
  );
}

export default function TextLineNode({
  item,
  canvasWidth,
  canvasHeight,
  isSelected,
  resolvedX,
  resolvedY,
  frameOffset,
  currentTime,
  itemsMap,
  audioItems,
  transformPreview,
  blinkPreview,
}: TextLineNodeProps) {
  const pxPerUnitX = canvasWidth / FRAME_W;
  const pxPerUnitY = canvasHeight / FRAME_H;

  const canvasToManim = (cx: number, cy: number) => ({
    mx: (cx / canvasWidth - 0.5) * FRAME_W - frameOffset.x,
    my: (0.5 - cy / canvasHeight) * FRAME_H - frameOffset.y,
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

  const [tintedImg, setTintedImg] = useState<HTMLImageElement | null>(null);
  const blinkTintColor = blinkPreview?.blinkColor ?? null;

  useEffect(() => {
    if (!img || !blinkTintColor) {
      setTintedImg(null);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setTintedImg(null);
      return;
    }
    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = blinkTintColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const el = new window.Image();
    el.onload = () => setTintedImg(el);
    el.src = canvas.toDataURL('image/png');
    return () => {
      el.onload = null;
    };
  }, [img, blinkTintColor]);

  const displayLabel = item.label || item.raw.slice(0, 30) || '(empty line)';

  const imageGeometry: ImageGeometry | null = hasMeasure && item.measure
    ? {
        x: -pxW / 2 + offX,
        y: -pxH / 2 + offY,
        width: pxW,
        height: pxH,
        inkLeft: item.measure.inkLeftX,
        inkTop: item.measure.inkTopY,
        inkWidth: item.measure.widthInk,
        inkHeight: item.measure.heightInk,
      }
    : null;

  const fullImage = img ? (
    <KonvaImage
      image={img}
      x={-pxW / 2 + offX}
      y={-pxH / 2 + offY}
      width={pxW}
      height={pxH}
      listening={false}
    />
  ) : null;

  const segmentPreview = (() => {
    if (!canRenderSegments(item, img) || !imageGeometry) return null;
    if (transformPreview) return null;
    if (textIntroFinished(item, currentTime, itemsMap, audioItems)) {
      return fullImage;
    }
    const states = textIntroSegmentStates(item, currentTime, itemsMap, audioItems);
    const fade = (item.animStyle ?? 'write') === 'fade_in';
    return (
      <Group listening={false}>
        {states.map((state) => {
          const box = segmentBoxForIndex(item, state.index);
          if (!box || !state.visible) return null;
          const rect = segmentRect(box, imageGeometry, img);
          const revealDirection = segmentRevealDirection(item, state.index);
          return renderSegmentImage(
            img,
            rect,
            `seg-${state.index}`,
            state.opacity,
            fade ? 1 : state.progress,
            revealDirection,
          );
        })}
      </Group>
    );
  })();

  const transformSegmentPreview = (() => {
    if (!transformPreview || !canRenderSegments(item, img) || !imageGeometry) {
      return null;
    }
    const p = transformPreview.progress;
    const isSource = item.id === transformPreview.source.id;
    const tc = transformPreview.target.transformConfig;
    if (!tc) return null;
    const pairs = tc.segmentPairs;
    const mappedSources = new Set(Object.values(pairs).map((v) => Number(v)));

    const sourcePosX = (transformPreview.sourceResolvedX / FRAME_W + 0.5) * canvasWidth;
    const sourcePosY = (0.5 - transformPreview.sourceResolvedY / FRAME_H) * canvasHeight;
    const targetPosX = (transformPreview.targetResolvedX / FRAME_W + 0.5) * canvasWidth;
    const targetPosY = (0.5 - transformPreview.targetResolvedY / FRAME_H) * canvasHeight;
    const selfPosX = isSource ? sourcePosX : targetPosX;
    const selfPosY = isSource ? sourcePosY : targetPosY;

    const targetGeomForBox = (target: TextLineItem): ImageGeometry | null => {
      const m = target.measure;
      if (!m || m.widthInk <= 0 || m.heightInk <= 0) return null;
      const targetPxW = m.widthInk * pxPerUnitX * target.scale;
      const targetPxH = m.heightInk * pxPerUnitY * target.scale;
      return {
        x: -targetPxW / 2 + m.offsetInkX * pxPerUnitX,
        y: -targetPxH / 2 - m.offsetInkY * pxPerUnitY,
        width: targetPxW,
        height: targetPxH,
        inkLeft: m.inkLeftX,
        inkTop: m.inkTopY,
        inkWidth: m.widthInk,
        inkHeight: m.heightInk,
      };
    };
    const sourceGeom = isSource ? imageGeometry : targetGeomForBox(transformPreview.source);
    const targetGeom = isSource ? targetGeomForBox(transformPreview.target) : imageGeometry;
    if (!sourceGeom || !targetGeom) return null;

    const segmentGlobalCenter = (
      owner: TextLineItem,
      geom: ImageGeometry,
      index: number,
      anchorX: number,
      anchorY: number,
    ) => {
      const box = segmentBoxForIndex(owner, index);
      if (!box) return null;
      const rect = segmentRect(box, geom, img);
      return { x: anchorX + rect.centerX, y: anchorY + rect.centerY };
    };

    return (
      <Group listening={false}>
        {item.segments.map((_, idx) => {
          const box = segmentBoxForIndex(item, idx);
          if (!box) return null;
          const rect = segmentRect(box, imageGeometry, img);

          if (isSource) {
            if (mappedSources.has(idx)) {
              const targetIdx = Object.entries(pairs).find(([, src]) => Number(src) === idx)?.[0];
              if (targetIdx == null) return null;
              const dest = segmentGlobalCenter(
                transformPreview.target,
                targetGeom,
                Number(targetIdx),
                targetPosX,
                targetPosY,
              );
              if (!dest) return null;
              const dx = dest.x - (sourcePosX + rect.centerX);
              const dy = dest.y - (sourcePosY + rect.centerY);
              return renderSegmentImage(
                img,
                rect,
                `xform-src-${idx}`,
                1 - p,
                1,
                segmentRevealDirection(item, idx),
                dx * p,
                dy * p,
              );
            }
            const opacity = tc.unmappedSourceBehavior === 'fade_out' ? 1 - p : 1;
            return renderSegmentImage(
              img,
              rect,
              `xform-src-unmapped-${idx}`,
              opacity,
              1,
              segmentRevealDirection(item, idx),
            );
          }

          const srcIdx = pairs[idx as keyof typeof pairs];
          if (srcIdx !== undefined) {
            const src = segmentGlobalCenter(
              transformPreview.source,
              sourceGeom,
              Number(srcIdx),
              sourcePosX,
              sourcePosY,
            );
            if (!src) return null;
            const startX = src.x - selfPosX;
            const startY = src.y - selfPosY;
            const dx = startX - rect.centerX;
            const dy = startY - rect.centerY;
            return renderSegmentImage(
              img,
              rect,
              `xform-tgt-${idx}`,
              p,
              1,
              segmentRevealDirection(item, idx),
              dx * (1 - p),
              dy * (1 - p),
            );
          }
          return renderSegmentImage(
            img,
            rect,
            `xform-tgt-unmapped-${idx}`,
            p,
            tc.unmappedTargetBehavior === 'write' ? p : 1,
            segmentRevealDirection(item, idx),
          );
        })}
      </Group>
    );
  })();

  const blinkTintOverlay = (() => {
    if (!blinkPreview || blinkPreview.colorMix <= 1e-6) return null;
    if (!canRenderSegments(item, img) || !imageGeometry) return null;
    if (!tintedImg) return null;
    const op = clamp01(blinkPreview.colorMix);
    const indices =
      blinkPreview.textSegmentIndices ??
      new Set(item.segments.map((_, i) => i));
    const childSeg = new Set(
      (blinkPreview.textMathChildHighlights ?? []).map((h) => h.segmentIndex),
    );
    const childNodes = (blinkPreview.textMathChildHighlights ?? []).map(
      (h, hi) => {
        if (!indices.has(h.segmentIndex)) return null;
        const m = item.mathChildMeasures?.find(
          (b) =>
            b.segmentIndex === h.segmentIndex && b.childIndex === h.childIndex,
        );
        if (!m) return null;
        const rect = segmentRect(
          { cx: m.cx, cy: m.cy, w: m.w, h: m.h },
          imageGeometry,
          img,
        );
        return renderCroppedImage(
          tintedImg,
          rect,
          `blink-m-${h.segmentIndex}-${h.childIndex}-${hi}`,
          op,
        );
      },
    );
    return (
      <Group listening={false}>
        {item.segments.map((_, idx) => {
          if (!indices.has(idx)) return null;
          if (childSeg.has(idx)) return null;
          const box = segmentBoxForIndex(item, idx);
          if (!box) return null;
          const rect = segmentRect(box, imageGeometry, img);
          return renderCroppedImage(tintedImg, rect, `blink-${idx}`, op);
        })}
        {childNodes}
      </Group>
    );
  })();

  const blinkPiecewiseScale = (() => {
    if (!blinkPreview || blinkPreview.applyOuterBlinkScale) return null;
    if (blinkPreview.row.mode !== 'scale') {
      return null;
    }
    if (!canRenderSegments(item, img) || !imageGeometry) return null;
    const sf = blinkPreview.scaleMultiplier;
    if (sf <= 1 + 1e-6) return null;
    const pieces = resolveTextBlinkPieces(item, blinkPreview.row);
    return (
      <Group listening={false}>
        {pieces.flatMap((p) => {
          if (p.whole) {
            const box = segmentBoxForIndex(item, p.segmentIndex);
            if (!box) return [];
            const rect = segmentRect(box, imageGeometry, img);
            const cx = rect.centerX;
            const cy = rect.centerY;
            return [
              <Group
                key={`blink-sc-${p.segmentIndex}`}
                x={cx}
                y={cy}
                scaleX={sf}
                scaleY={sf}
              >
                <Group x={-cx} y={-cy}>
                  {renderCroppedImage(img, rect, `blink-sc-img-${p.segmentIndex}`, 0.92)}
                </Group>
              </Group>,
            ];
          }
          return p.childIndices
            .map((c) => {
              const m = item.mathChildMeasures?.find(
                (b) =>
                  b.segmentIndex === p.segmentIndex && b.childIndex === c,
              );
              if (!m) return null;
              const rect = segmentRect(
                { cx: m.cx, cy: m.cy, w: m.w, h: m.h },
                imageGeometry,
                img,
              );
              const cx = rect.centerX;
              const cy = rect.centerY;
              return (
                <Group
                  key={`blink-sc-${p.segmentIndex}-${c}`}
                  x={cx}
                  y={cy}
                  scaleX={sf}
                  scaleY={sf}
                >
                  <Group x={-cx} y={-cy}>
                    {renderCroppedImage(
                      img,
                      rect,
                      `blink-sc-img-${p.segmentIndex}-${c}`,
                      0.92,
                    )}
                  </Group>
                </Group>
              );
            })
            .filter((x): x is ReactElement => x != null);
        })}
      </Group>
    );
  })();

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
      {transformSegmentPreview ?? segmentPreview ?? fullImage}
      {blinkPiecewiseScale}
      {blinkTintOverlay}

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
