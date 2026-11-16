import { useSceneStore } from '@/store/useSceneStore';
import type { ItemId } from '@/types/scene';

/**
 * Start a live-updating drag: pause undo history so the many live moves become one step, but only
 * if it is recording. Returns whether this drag paused it (and so must resume it at the end).
 */
export function pauseHistoryForDrag(): boolean {
  const history = useSceneStore.temporal.getState();
  if (!history.isTracking) return false;
  history.pause();
  return true;
}

/**
 * Finish a live-updating drag. `pausedByDrag`: the drag paused undo history at pointer-down (it was
 * recording then), so it is resumed here and the move is recorded as one step. When history was
 * already paused by something else, it stays paused and the final position is simply set.
 */
export function finishPositionDrag(
  id: ItemId,
  start: { x: number; y: number } | null,
  final: { x: number; y: number },
  pausedByDrag = true,
): void {
  const store = useSceneStore.getState();
  const item = store.items.get(id);
  if (!item || !('x' in item) || !start) {
    if (pausedByDrag) useSceneStore.temporal.getState().resume();
    return;
  }
  const changed = Math.abs(start.x - final.x) > 1e-9 || Math.abs(start.y - final.y) > 1e-9;
  if (!pausedByDrag) {
    if (changed) store.setItemPosition(id, final.x, final.y);
    return;
  }
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
