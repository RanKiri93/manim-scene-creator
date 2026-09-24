import { useCallback, useEffect, useRef } from 'react';
import type Konva from 'konva';
import { useSceneStore } from '@/store/useSceneStore';
import type { ItemId, PosStep } from '@/types/scene';
import { isMultiSelectModifier } from '@/lib/uiModifiers';
import { snapTextPosition, type SnapBox, type TextSnapGuide } from '@/lib/textSnap';
import { FRAME_H, FRAME_W } from '@/lib/constants';
import { cancelPositionDrag, finishPositionDrag } from '@/store/positionDrag';

export interface TextSnapContext {
  enabled: boolean;
  frameOffset: { x: number; y: number };
  frameCenter: { x: number; y: number };
  ink: { left: number; right: number; bottom: number; top: number } | null;
  targets: SnapBox[];
  pxPerUnitX: number;
  pxPerUnitY: number;
  buffer: number;
  canvasWidth: number;
  canvasHeight: number;
  onGuides: (guides: TextSnapGuide[]) => void;
  isTargetValid?: (id: string) => boolean;
}

interface UseDragSnapOptions {
  itemId: ItemId;
  posSteps: PosStep[];
  canvasToManim: (cx: number, cy: number) => { mx: number; my: number };
  gridSnap?: number | null;
  textSnap?: TextSnapContext;
}

/** True when the chain is empty or only `absolute` steps (free dragging allowed). */
export function isFreelyDraggable(steps: PosStep[]): boolean {
  return (
    steps.length === 0 ||
    steps.every((s) => s.kind === 'absolute')
  );
}

export function effectiveSnapPixelsPerUnit(
  basePixelsPerUnit: number,
  viewportScale: number,
): number {
  return basePixelsPerUnit * Math.abs(viewportScale);
}

function applyDragPosition(
  node: Konva.Node,
  canvasToManim: UseDragSnapOptions['canvasToManim'],
  gridSnap: number | null,
  setItemPosition: (id: ItemId, x: number, y: number) => void,
  id: ItemId,
) {
  let { mx, my } = canvasToManim(node.x(), node.y());
  if (gridSnap && gridSnap > 0) {
    mx = Math.round(mx / gridSnap) * gridSnap;
    my = Math.round(my / gridSnap) * gridSnap;
  }
  setItemPosition(id, mx, my);
}

export function useDragSnap({ itemId, posSteps, canvasToManim, gridSnap = null, textSnap }: UseDragSnapOptions) {
  const setItemPosition = useSceneStore((s) => s.setItemPosition);
  const select = useSceneStore((s) => s.select);
  const isDragging = useRef(false);
  const startPosition = useRef<{ x: number; y: number } | null>(null);
  const latch = useRef<{ x: string | null; y: string | null }>({ x: null, y: null });
  const targetsAtStart = useRef<SnapBox[] | null>(null);

  const draggable = isFreelyDraggable(posSteps);

  useEffect(() => () => {
    if (!isDragging.current) return;
    cancelPositionDrag(itemId, startPosition.current);
    startPosition.current = null;
    targetsAtStart.current = null;
    isDragging.current = false;
    useSceneStore.temporal.getState().resume();
  }, [itemId]);

  const onDragStart = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      useSceneStore.temporal.getState().pause();
      isDragging.current = true;
      const item = useSceneStore.getState().items.get(itemId);
      startPosition.current = item && 'x' in item ? { x: item.x, y: item.y } : null;
      latch.current = { x: null, y: null };
      targetsAtStart.current = textSnap?.targets.slice() ?? null;
      textSnap?.onGuides([]);
      select(itemId, isMultiSelectModifier(e.evt));
    },
    [itemId, select, textSnap],
  );

  const onDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const { mx, my } = canvasToManim(e.target.x(), e.target.y());
      const bypass = e.evt.altKey;
      if (textSnap?.enabled && textSnap.ink && !bypass) {
        const worldX = mx + textSnap.frameOffset.x;
        const worldY = my + textSnap.frameOffset.y;
        const result = snapTextPosition({
          x: worldX,
          y: worldY,
          ink: textSnap.ink,
          targets: (targetsAtStart.current ?? textSnap.targets).filter((target) => textSnap.isTargetValid?.(target.id) ?? true),
          frameCenter: textSnap.frameCenter,
          buffer: textSnap.buffer,
          pxPerUnitX: textSnap.pxPerUnitX,
          pxPerUnitY: textSnap.pxPerUnitY,
          priorXTargetId: latch.current.x,
          priorYTargetId: latch.current.y,
        });
        latch.current = {
          x: result.guides.find((g) => g.axis === 'x')?.targetId ?? null,
          y: result.guides.find((g) => g.axis === 'y')?.targetId ?? null,
        };
        textSnap.onGuides(result.guides);
        const localX = result.x - textSnap.frameOffset.x;
        const localY = result.y - textSnap.frameOffset.y;
        e.target.position({
          x: ((localX / FRAME_W) + 0.5) * textSnap.canvasWidth,
          y: (0.5 - localY / FRAME_H) * textSnap.canvasHeight,
        });
        setItemPosition(itemId, localX, localY);
      } else {
        latch.current = { x: null, y: null };
        textSnap?.onGuides([]);
        applyDragPosition(e.target, canvasToManim, gridSnap, setItemPosition, itemId);
      }
    },
    [itemId, canvasToManim, gridSnap, setItemPosition, textSnap],
  );

  const onDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      isDragging.current = false;
      let temporalResumed = false;
      try {
        // Record the live gesture as one undoable spatial transaction: restore the
        // starting coordinates while history is paused, resume, then commit final.
        const { mx, my } = canvasToManim(e.target.x(), e.target.y());
        const bypass = e.evt.altKey;
        let final = { x: mx, y: my };
        if (textSnap?.enabled && textSnap.ink && !bypass) {
          const world = snapTextPosition({
            x: mx + textSnap.frameOffset.x,
            y: my + textSnap.frameOffset.y,
            ink: textSnap.ink,
            targets: (targetsAtStart.current ?? textSnap.targets).filter((target) => textSnap.isTargetValid?.(target.id) ?? true),
            frameCenter: textSnap.frameCenter,
            buffer: textSnap.buffer,
            pxPerUnitX: textSnap.pxPerUnitX,
            pxPerUnitY: textSnap.pxPerUnitY,
            priorXTargetId: latch.current.x,
            priorYTargetId: latch.current.y,
          });
          final = { x: world.x - textSnap.frameOffset.x, y: world.y - textSnap.frameOffset.y };
          e.target.position({
            x: ((world.x - textSnap.frameOffset.x) / FRAME_W + 0.5) * textSnap.canvasWidth,
            y: (0.5 - (world.y - textSnap.frameOffset.y) / FRAME_H) * textSnap.canvasHeight,
          });
        }
        finishPositionDrag(itemId, startPosition.current, final);
        temporalResumed = true;
      } finally {
        startPosition.current = null;
        latch.current = { x: null, y: null };
        targetsAtStart.current = null;
        textSnap?.onGuides([]);
        if (!temporalResumed) useSceneStore.temporal.getState().resume();
      }
    },
    [itemId, canvasToManim, textSnap],
  );

  return { onDragStart, onDragMove, onDragEnd, isDragging, draggable };
}
