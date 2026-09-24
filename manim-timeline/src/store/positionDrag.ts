import { useSceneStore } from '@/store/useSceneStore';
import type { ItemId } from '@/types/scene';

/** Finish a live-updating drag that was paused from its pointer-down event. */
export function finishPositionDrag(
  id: ItemId,
  start: { x: number; y: number } | null,
  final: { x: number; y: number },
): void {
  const store = useSceneStore.getState();
  const item = store.items.get(id);
  if (!item || !('x' in item) || !start) {
    useSceneStore.temporal.getState().resume();
    return;
  }
  const changed = Math.abs(start.x - final.x) > 1e-9 || Math.abs(start.y - final.y) > 1e-9;
  if (changed) store.setItemPosition(id, start.x, start.y);
  useSceneStore.temporal.getState().resume();
  if (changed) useSceneStore.getState().setItemPosition(id, final.x, final.y);
}

/** Cancel only the moved coordinates; callers own the matching temporal resume. */
export function cancelPositionDrag(
  id: ItemId,
  start: { x: number; y: number } | null,
): void {
  if (!start) return;
  const item = useSceneStore.getState().items.get(id);
  if (item && 'x' in item) useSceneStore.getState().setItemPosition(id, start.x, start.y);
}
