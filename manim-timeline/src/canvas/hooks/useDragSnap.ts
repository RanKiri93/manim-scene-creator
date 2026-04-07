import { useCallback, useRef } from 'react';
import type Konva from 'konva';
import { useSceneStore } from '@/store/useSceneStore';
import type { ItemId, PosStep } from '@/types/scene';

interface UseDragSnapOptions {
  itemId: ItemId;
  posSteps: PosStep[];
  canvasToManim: (cx: number, cy: number) => { mx: number; my: number };
  gridSnap?: number | null;
}

/** True when the chain contains only `absolute` steps (free dragging allowed). */
function isFreelyDraggable(steps: PosStep[]): boolean {
  return steps.every((s) => s.kind === 'absolute');
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

export function useDragSnap({ itemId, posSteps, canvasToManim, gridSnap = null }: UseDragSnapOptions) {
  const setItemPosition = useSceneStore((s) => s.setItemPosition);
  const select = useSceneStore((s) => s.select);
  const isDragging = useRef(false);

  const draggable = isFreelyDraggable(posSteps);

  const onDragStart = useCallback(
    (_e: Konva.KonvaEventObject<DragEvent>) => {
      useSceneStore.temporal.getState().pause();
      isDragging.current = true;
      select(itemId);
    },
    [itemId, select],
  );

  const onDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      applyDragPosition(e.target, canvasToManim, gridSnap, setItemPosition, itemId);
    },
    [itemId, canvasToManim, gridSnap, setItemPosition],
  );

  const onDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      isDragging.current = false;
      try {
        applyDragPosition(e.target, canvasToManim, gridSnap, setItemPosition, itemId);
      } finally {
        useSceneStore.temporal.getState().resume();
      }
    },
    [itemId, canvasToManim, gridSnap, setItemPosition],
  );

  return { onDragStart, onDragMove, onDragEnd, isDragging, draggable };
}
