import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Group, Image as KonvaImage, Rect, Text, Transformer } from 'react-konva';
import type Konva from 'konva';
import type { ImageItem } from '@/types/scene';
import { isFreelyDraggable } from '@/canvas/hooks/useDragSnap';
import { FRAME_W, FRAME_H } from '@/lib/constants';
import { useSceneStore } from '@/store/useSceneStore';
import { isMultiSelectModifier } from '@/lib/uiModifiers';
import { clampImageOpacity } from '@/lib/imageAssetPath';

const TRANSFORMER_ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-right',
  'middle-left',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const;

interface ImageNodeProps {
  item: ImageItem;
  canvasWidth: number;
  canvasHeight: number;
  isSelected: boolean;
  resolvedX: number;
  resolvedY: number;
  frameOffset: { x: number; y: number };
  /** Playback preview: added to Konva CW rotation (`item.rotationDeg`). */
  previewRotationDeltaDeg?: number;
}

export default function ImageNode({
  item,
  canvasWidth,
  canvasHeight,
  isSelected,
  resolvedX,
  resolvedY,
  frameOffset,
  previewRotationDeltaDeg = 0,
}: ImageNodeProps) {
  const pxPerUnitX = canvasWidth / FRAME_W;
  const pxPerUnitY = canvasHeight / FRAME_H;
  const updateItem = useSceneStore((s) => s.updateItem);
  const setItemPosition = useSceneStore((s) => s.setItemPosition);
  const select = useSceneStore((s) => s.select);
  const selectedIds = useSceneStore((s) => s.selectedIds);

  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadedSrc, setLoadedSrc] = useState(item.srcUrl);

  // Reset the raster when the source changes (render-phase update: React
  // re-renders immediately instead of cascading an effect).
  if (loadedSrc !== item.srcUrl) {
    setLoadedSrc(item.srcUrl);
    setImg(null);
    setLoadError(false);
  }

  useEffect(() => {
    let cancelled = false;
    const el = new Image();
    el.onload = () => {
      if (!cancelled) setImg(el);
    };
    el.onerror = () => {
      if (!cancelled) setLoadError(true);
    };
    el.src = item.srcUrl;
    return () => {
      cancelled = true;
    };
  }, [item.srcUrl]);

  const groupRef = useRef<Konva.Group>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  /** True while dragging the body or transforming — skip React→Konva sync that causes jumps. */
  const interactionRef = useRef(false);

  const canvasToManim = useCallback(
    (cx: number, cy: number) => ({
      mx: (cx / canvasWidth - 0.5) * FRAME_W - frameOffset.x,
      my: (0.5 - cy / canvasHeight) * FRAME_H - frameOffset.y,
    }),
    [canvasWidth, canvasHeight, frameOffset],
  );

  const draggable = isFreelyDraggable(item.posSteps);
  const showTransformer =
    isSelected && draggable && selectedIds.size === 1 && selectedIds.has(item.id);

  const posX = (resolvedX / FRAME_W + 0.5) * canvasWidth;
  const posY = (0.5 - resolvedY / FRAME_H) * canvasHeight;

  useLayoutEffect(() => {
    const tr = transformerRef.current;
    const g = groupRef.current;
    if (!tr) return;
    if (showTransformer && g) {
      tr.nodes([g]);
    } else {
      tr.nodes([]);
    }
    tr.getLayer()?.batchDraw();
  }, [showTransformer, item.id]);

  useLayoutEffect(() => {
    const n = groupRef.current;
    if (!n || interactionRef.current) return;
    n.x(posX);
    n.y(posY);
    n.rotation(item.rotationDeg + previewRotationDeltaDeg);
    n.scaleX(item.scale);
    n.scaleY(item.scale);
    n.getLayer()?.batchDraw();
  }, [posX, posY, item.rotationDeg, previewRotationDeltaDeg, item.scale, item.id]);

  const w = Math.max(0.05, item.width) * pxPerUnitX;
  const h = Math.max(0.05, item.height) * pxPerUnitY;

  const onDragStart = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      interactionRef.current = true;
      useSceneStore.temporal.getState().pause();
      select(item.id, isMultiSelectModifier(e.evt));
    },
    [item.id, select],
  );

  const onDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const n = e.target as Konva.Group;
      const { mx, my } = canvasToManim(n.x(), n.y());
      setItemPosition(item.id, mx, my);
      interactionRef.current = false;
      useSceneStore.temporal.getState().resume();
    },
    [item.id, setItemPosition, canvasToManim],
  );

  const onTransformStart = useCallback(() => {
    interactionRef.current = true;
    useSceneStore.temporal.getState().pause();
  }, []);

  const onTransformEnd = useCallback(() => {
    const n = groupRef.current;
    if (!n) {
      interactionRef.current = false;
      useSceneStore.temporal.getState().resume();
      return;
    }

    const raw = useSceneStore.getState().items.get(item.id);
    const base = raw?.kind === 'image' ? raw : item;

    const sx = n.scaleX();
    const sy = n.scaleY();
    const { mx, my } = canvasToManim(n.x(), n.y());
    const rot = n.rotation() - previewRotationDeltaDeg;
    const baseScale = base.scale > 1e-9 ? base.scale : 1;
    const kx = sx / baseScale;
    const ky = sy / baseScale;

    updateItem(item.id, {
      x: mx,
      y: my,
      rotationDeg: rot,
      width: Math.max(0.05, base.width * kx),
      height: Math.max(0.05, base.height * ky),
    });
    interactionRef.current = false;
    useSceneStore.temporal.getState().resume();
    n.getLayer()?.batchDraw();
  }, [item, updateItem, previewRotationDeltaDeg, canvasToManim]);

  const body = (() => {
    if (img && !loadError) {
      return (
        <KonvaImage
          image={img}
          x={-w / 2}
          y={-h / 2}
          width={w}
          height={h}
          opacity={clampImageOpacity(item.opacity)}
        />
      );
    }
    return (
      <Group>
        <Rect
          x={-w / 2}
          y={-h / 2}
          width={w}
          height={h}
          stroke={loadError ? '#f87171' : '#64748b'}
          strokeWidth={1.5}
          dash={[6, 4]}
          fill="rgba(100,116,139,0.15)"
        />
        <Text
          x={-w / 2}
          y={-7}
          width={w}
          align="center"
          text={loadError ? 'Image missing' : 'Loading…'}
          fontSize={12}
          fill={loadError ? '#fca5a5' : '#94a3b8'}
          listening={false}
        />
      </Group>
    );
  })();

  return (
    <>
      <Group
        ref={groupRef}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={(e) => {
          e.cancelBubble = true;
          useSceneStore.getState().select(item.id, isMultiSelectModifier(e.evt));
        }}
        onTap={(e) => {
          e.cancelBubble = true;
          useSceneStore.getState().select(item.id, isMultiSelectModifier(e.evt));
        }}
      >
        {body}
        <Rect
          x={-w / 2 - 4}
          y={-h / 2 - 4}
          width={w + 8}
          height={h + 8}
          stroke={isSelected ? '#3b82f6' : 'transparent'}
          strokeWidth={isSelected ? 2 : 0}
          listening={false}
        />
      </Group>
      {showTransformer && (
        <Transformer
          ref={transformerRef}
          rotateEnabled
          enabledAnchors={[...TRANSFORMER_ANCHORS]}
          padding={6}
          borderStroke="#3b82f6"
          borderStrokeWidth={1}
          anchorFill="#93c5fd"
          anchorStroke="#1d4ed8"
          anchorSize={8}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 8 || newBox.height < 8) return oldBox;
            return newBox;
          }}
          onTransformStart={onTransformStart}
          onTransformEnd={onTransformEnd}
        />
      )}
    </>
  );
}
