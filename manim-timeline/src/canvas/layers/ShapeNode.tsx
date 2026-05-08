import { useCallback, useLayoutEffect, useRef } from 'react';
import {
  Group,
  Circle,
  Rect,
  Line as KonvaLine,
  Arrow as KonvaArrow,
  Transformer,
} from 'react-konva';
import type Konva from 'konva';
import type { ShapeItem, ShapePoint } from '@/types/scene';
import { isFreelyDraggable } from '@/canvas/hooks/useDragSnap';
import { FRAME_W, FRAME_H } from '@/lib/constants';
import { useSceneStore } from '@/store/useSceneStore';
import { isMultiSelectModifier } from '@/lib/uiModifiers';

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

function polyArrowSegment(
  points: ShapePoint[],
  at: 'head' | 'tail',
): [ShapePoint, ShapePoint] | null {
  if (points.length < 2) return null;
  if (at === 'head') {
    const a = points[points.length - 2]!;
    const b = points[points.length - 1]!;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) return null;
    return [a, b];
  }
  const a = points[1]!;
  const b = points[0]!;
  if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-9) return null;
  return [a, b];
}

function polylineSelectionOutlineProps(
  points: ShapePoint[],
  pxPerUnitX: number,
  pxPerUnitY: number,
): { x: number; y: number; width: number; height: number } | null {
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x * pxPerUnitX);
  const ys = points.map((p) => -p.y * pxPerUnitY);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 6;
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

interface ShapeNodeProps {
  item: ShapeItem;
  canvasWidth: number;
  canvasHeight: number;
  isSelected: boolean;
  resolvedX: number;
  resolvedY: number;
  /** Playback preview: overrides item stroke when set. */
  previewStrokeColor?: string;
  /** Playback preview: overrides item fill when set (use transparent to clear). */
  previewFillColor?: string | null;
}

export default function ShapeNode({
  item,
  canvasWidth,
  canvasHeight,
  isSelected,
  resolvedX,
  resolvedY,
  previewStrokeColor,
  previewFillColor,
}: ShapeNodeProps) {
  const pxPerUnitX = canvasWidth / FRAME_W;
  const pxPerUnitY = canvasHeight / FRAME_H;
  const updateItem = useSceneStore((s) => s.updateItem);
  const setItemPosition = useSceneStore((s) => s.setItemPosition);
  const select = useSceneStore((s) => s.select);
  const selectedIds = useSceneStore((s) => s.selectedIds);

  const shapeGroupRef = useRef<Konva.Group>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  /** True while dragging the body or transforming — skip React→Konva sync that causes jumps. */
  const interactionRef = useRef(false);

  const canvasToManim = (cx: number, cy: number) => ({
    mx: (cx / canvasWidth - 0.5) * FRAME_W,
    my: (0.5 - cy / canvasHeight) * FRAME_H,
  });

  const draggable = isFreelyDraggable(item.posSteps);
  const showTransformer =
    item.shapeType !== 'polyline' &&
    isSelected &&
    draggable &&
    selectedIds.size === 1 &&
    selectedIds.has(item.id);

  const posX = (resolvedX / FRAME_W + 0.5) * canvasWidth;
  const posY = (0.5 - resolvedY / FRAME_H) * canvasHeight;

  useLayoutEffect(() => {
    const tr = transformerRef.current;
    const sh = shapeGroupRef.current;
    if (!tr) return;
    if (showTransformer && sh) {
      tr.nodes([sh]);
    } else {
      tr.nodes([]);
    }
    tr.getLayer()?.batchDraw();
  }, [showTransformer, item.id]);

  useLayoutEffect(() => {
    const n = shapeGroupRef.current;
    if (!n || interactionRef.current) return;
    n.x(posX);
    n.y(posY);
    n.rotation(item.rotationDeg);
    n.scaleX(item.scale);
    n.scaleY(item.scale);
    n.getLayer()?.batchDraw();
  }, [
    posX,
    posY,
    item.rotationDeg,
    item.scale,
    item.radius,
    item.width,
    item.height,
    item.endX,
    item.endY,
    item.shapeType,
    item.points,
    item.id,
  ]);

  const bboxHalfPx = (): number => {
    const s = item.scale;
    switch (item.shapeType) {
      case 'circle': {
        const r = item.radius * pxPerUnitX * s;
        return Math.max(24, r + 8);
      }
      case 'rectangle': {
        const w = item.width * pxPerUnitX * s;
        const h = item.height * pxPerUnitY * s;
        return Math.max(24, Math.max(w, h) / 2 + 8);
      }
      case 'arrow':
      case 'line': {
        const x2 = Math.abs(item.endX) * pxPerUnitX * s;
        const y2 = Math.abs(item.endY) * pxPerUnitY * s;
        const half = Math.hypot(x2, y2) / 2;
        return Math.max(24, half + 8);
      }
      case 'polyline': {
        if (item.points.length === 0) return 24;
        const xs = item.points.map((p) => p.x * pxPerUnitX * s);
        const ys = item.points.map((p) => p.y * pxPerUnitY * s);
        const w = Math.max(...xs) - Math.min(...xs);
        const h = Math.max(...ys) - Math.min(...ys);
        return Math.max(24, Math.hypot(w, h) / 2 + 8);
      }
      default:
        return 24;
    }
  };

  const rh = bboxHalfPx();

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
    [item.id, setItemPosition, canvasWidth, canvasHeight],
  );

  const onTransformStart = useCallback(() => {
    interactionRef.current = true;
    useSceneStore.temporal.getState().pause();
  }, []);

  const onTransformEnd = useCallback(() => {
    const n = shapeGroupRef.current;
    if (!n) {
      interactionRef.current = false;
      useSceneStore.temporal.getState().resume();
      return;
    }

    const raw = useSceneStore.getState().items.get(item.id);
    const base = raw?.kind === 'shape' ? raw : item;

    const sx = n.scaleX();
    const sy = n.scaleY();
    const { mx, my } = canvasToManim(n.x(), n.y());
    const rot = n.rotation();

    const minDim = 0.05;
    const patch: Partial<ShapeItem> = {
      x: mx,
      y: my,
      rotationDeg: rot,
      scale: 1,
    };

    switch (base.shapeType) {
      case 'circle':
        patch.radius = Math.max(minDim, base.radius * Math.sqrt(Math.max(1e-8, sx * sy)));
        break;
      case 'rectangle':
        patch.width = Math.max(minDim, base.width * sx);
        patch.height = Math.max(minDim, base.height * sy);
        break;
      case 'arrow':
      case 'line':
        patch.endX = base.endX * sx;
        patch.endY = base.endY * sy;
        break;
      case 'polyline':
        patch.points = base.points.map((p) => ({ x: p.x * sx, y: p.y * sy }));
        break;
      default:
        break;
    }

    updateItem(item.id, patch);
    n.scaleX(1);
    n.scaleY(1);
    transformerRef.current?.forceUpdate();
    interactionRef.current = false;
    useSceneStore.temporal.getState().resume();
    n.getLayer()?.batchDraw();
  }, [item.id, item, updateItem, canvasWidth, canvasHeight]);

  const stroke = previewStrokeColor ?? (item.strokeColor || '#60a5fa');
  const fillSource = previewFillColor !== undefined ? previewFillColor : item.fillColor;
  const fill = fillSource?.trim() ? fillSource : undefined;
  const previewStrokeWidth = Math.max(1, item.strokeWidth);
  const arrowPointerSize = Math.max(10, previewStrokeWidth * 2.5);

  const inner = (() => {
    switch (item.shapeType) {
      case 'circle': {
        const r = item.radius * pxPerUnitX;
        return (
          <Circle
            radius={r}
            stroke={stroke}
            strokeWidth={previewStrokeWidth}
            fill={fill ?? 'transparent'}
            opacity={fill ? Math.max(0.15, item.fillOpacity) : 1}
          />
        );
      }
      case 'rectangle': {
        const w = item.width * pxPerUnitX;
        const h = item.height * pxPerUnitY;
        return (
          <Rect
            x={-w / 2}
            y={-h / 2}
            width={w}
            height={h}
            stroke={stroke}
            strokeWidth={previewStrokeWidth}
            fill={fill ?? 'transparent'}
            opacity={fill ? Math.max(0.15, item.fillOpacity) : 1}
          />
        );
      }
      case 'arrow': {
        const x2 = item.endX * pxPerUnitX;
        const y2 = -item.endY * pxPerUnitY;
        return (
          <Group x={-x2 / 2} y={-y2 / 2}>
            <KonvaArrow
              points={[0, 0, x2, y2]}
              stroke={stroke}
              fill={stroke}
              strokeWidth={previewStrokeWidth}
              pointerLength={arrowPointerSize}
              pointerWidth={arrowPointerSize}
            />
          </Group>
        );
      }
      case 'line': {
        const x2 = item.endX * pxPerUnitX;
        const y2 = -item.endY * pxPerUnitY;
        return (
          <Group x={-x2 / 2} y={-y2 / 2}>
            <KonvaLine
              points={[0, 0, x2, y2]}
              stroke={stroke}
              strokeWidth={previewStrokeWidth}
            />
          </Group>
        );
      }
      case 'polyline': {
        const pts = item.points;
        if (pts.length === 0) {
          return (
            <KonvaLine
              points={[0, 0, 0.5, 0]}
              stroke={stroke}
              strokeWidth={1}
              opacity={0.35}
              dash={[4, 4]}
            />
          );
        }
        const flat = pts.flatMap((p) => [p.x * pxPerUnitX, -p.y * pxPerUnitY]);
        const headSeg =
          item.headArrow && polyArrowSegment(pts, 'head');
        const tailSeg =
          item.tailArrow && polyArrowSegment(pts, 'tail');
        const sw = previewStrokeWidth;
        return (
          <Group>
            <KonvaLine
              points={flat}
              stroke={stroke}
              strokeWidth={sw}
              lineCap="round"
              lineJoin="round"
            />
            {headSeg ? (
              <KonvaArrow
                points={[
                  headSeg[0]!.x * pxPerUnitX,
                  -headSeg[0]!.y * pxPerUnitY,
                  headSeg[1]!.x * pxPerUnitX,
                  -headSeg[1]!.y * pxPerUnitY,
                ]}
                stroke={stroke}
                fill={stroke}
                strokeWidth={sw}
                pointerLength={arrowPointerSize}
                pointerWidth={arrowPointerSize}
              />
            ) : null}
            {tailSeg ? (
              <KonvaArrow
                points={[
                  tailSeg[0]!.x * pxPerUnitX,
                  -tailSeg[0]!.y * pxPerUnitY,
                  tailSeg[1]!.x * pxPerUnitX,
                  -tailSeg[1]!.y * pxPerUnitY,
                ]}
                stroke={stroke}
                fill={stroke}
                strokeWidth={sw}
                pointerLength={arrowPointerSize}
                pointerWidth={arrowPointerSize}
              />
            ) : null}
          </Group>
        );
      }
      default:
        return null;
    }
  })();

  return (
    <>
      <Group
        ref={shapeGroupRef}
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
        {inner}
        {item.shapeType === 'polyline' ? (
          (() => {
            const box = polylineSelectionOutlineProps(
              item.points,
              pxPerUnitX,
              pxPerUnitY,
            );
            if (!box) return null;
            return (
              <Rect
                {...box}
                stroke={isSelected ? '#3b82f6' : 'transparent'}
                strokeWidth={isSelected ? 2 : 0}
                dash={[4, 4]}
                listening={false}
              />
            );
          })()
        ) : (
          <Rect
            x={-rh}
            y={-rh}
            width={rh * 2}
            height={rh * 2}
            stroke={isSelected ? '#3b82f6' : 'transparent'}
            strokeWidth={isSelected ? 2 : 0}
            listening={false}
          />
        )}
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
