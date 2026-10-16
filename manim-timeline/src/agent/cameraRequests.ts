import { FRAME_W } from '@/lib/constants';
import { cameraFollowAnchor, fitCameraBounds } from '@/lib/camera';
import { cameraObjectSnapshotBounds } from '@/lib/cameraBounds';
import { frameCenterById } from '@/lib/frameGrid';
import type { FrameDef, ItemId, SceneItem, CameraMoveItem } from '@/types/scene';

export interface CameraRequestContext {
  currentTimeSec: number;
  items: Map<ItemId, SceneItem>;
  frames: readonly FrameDef[];
  startFrameId: ItemId | null;
  activeFrameId: ItemId | null;
}

/** Resolve request-only model descriptors to an ordinary persisted camera clip. */
export function resolveCameraRequest(
  raw: Record<string, unknown>,
  context: CameraRequestContext,
  /** Scene items plus those created earlier in the same proposal (a follow target may be new). */
  planned: ReadonlyMap<ItemId, SceneItem> = context.items,
): { item?: CameraMoveItem; error?: string } {
  const mode = raw.targetMode;
  const frameId = typeof raw.targetFrameId === 'string' ? raw.targetFrameId : '';
  if (mode === 'follow') {
    // Follow is persisted (`follow.targetId`); width is the zoom, offsets shift the view from the target.
    const id = typeof raw.targetId === 'string' ? raw.targetId : '';
    const anchor = cameraFollowAnchor(id, planned);
    if (typeof anchor === 'string') return { error: anchor };
    const target = planned.get(id)!;
    const followFrame = ('frameId' in target && typeof target.frameId === 'string' ? target.frameId : null) ?? context.startFrameId ?? '';
    if (!context.frames.some((frame) => frame.id === followFrame)) return { error: 'Camera target frame is unavailable.' };
    const width = raw.targetWidth == null ? FRAME_W / 2 : raw.targetWidth;
    if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) return { error: 'Camera follow width must be a positive number of Manim units.' };
    const persisted = { ...raw };
    delete persisted.targetMode;
    delete persisted.targetId;
    delete persisted.region;
    return {
      item: {
        ...persisted,
        kind: 'camera_move',
        targetFrameId: followFrame,
        targetWidth: width,
        offsetX: typeof raw.offsetX === 'number' ? raw.offsetX : 0,
        offsetY: typeof raw.offsetY === 'number' ? raw.offsetY : 0,
        follow: { targetId: id },
      } as CameraMoveItem,
    };
  }
  let destination: { x: number; y: number; width: number } | null = null;
  let resolvedFrameId = frameId;
  if (mode === 'frame') {
    if (!context.frames.some((frame) => frame.id === frameId)) return { error: 'Camera target frame is missing or unknown.' };
    destination = { ...frameCenterById(context.frames, frameId), width: FRAME_W };
  } else if (mode === 'region') {
    const region = raw.region as Record<string, unknown> | undefined;
    if (!region || !['left', 'right', 'bottom', 'top'].every((key) => typeof region[key] === 'number' && Number.isFinite(region[key]))) return { error: 'Camera region needs finite world-space left, right, bottom, and top bounds.' };
    const fitted = fitCameraBounds(region as {left:number;right:number;bottom:number;top:number});
    if (!fitted.ok) return { error: fitted.reason };
    destination = fitted.destination;
    resolvedFrameId = frameId || context.startFrameId || '';
  } else if (mode === 'object') {
    const id = typeof raw.targetId === 'string' ? raw.targetId : '';
    if (!id || !context.items.has(id)) return { error: 'Camera object target must identify one existing scene item by exact id.' };
    const snapshot = cameraObjectSnapshotBounds(id, context.items, context.frames, context.startFrameId ?? '', context.currentTimeSec);
    if (!snapshot.ok) return { error: snapshot.reason };
    const fitted = fitCameraBounds(snapshot.bounds, 0.3);
    if (!fitted.ok) return { error: fitted.reason };
    destination = fitted.destination;
    resolvedFrameId = snapshot.targetFrameId;
  } else {
    return { error: 'Camera targetMode must be frame, region, object or follow.' };
  }
  if (!resolvedFrameId || !context.frames.some((frame) => frame.id === resolvedFrameId)) return { error: 'Camera target frame is unavailable.' };
  const center = frameCenterById(context.frames, resolvedFrameId);
  const frameX = center.x;
  const frameY = center.y;
  const resolvedOffsetX = destination.x - frameX;
  const resolvedOffsetY = destination.y - frameY;
  if (mode !== 'frame' && typeof raw.targetWidth === 'number' && Math.abs(raw.targetWidth - destination.width) > 1e-6) return { error: 'Numeric camera width conflicts with the measured snapshot target; use the resolved fit or ask for a different target.' };
  if (mode !== 'frame' && ((typeof raw.offsetX === 'number' && Math.abs(raw.offsetX - resolvedOffsetX) > 1e-6) || (typeof raw.offsetY === 'number' && Math.abs(raw.offsetY - resolvedOffsetY) > 1e-6))) return { error: 'Numeric camera offsets conflict with the resolved snapshot target.' };
  const width = mode === 'frame' && typeof raw.targetWidth === 'number' ? raw.targetWidth : destination.width;
  const offsetX = mode === 'frame' && typeof raw.offsetX === 'number' ? raw.offsetX : resolvedOffsetX;
  const offsetY = mode === 'frame' && typeof raw.offsetY === 'number' ? raw.offsetY : resolvedOffsetY;
  const persisted = { ...raw };
  delete persisted.targetMode;
  delete persisted.targetId;
  delete persisted.region;
  return { item: { ...persisted, kind: 'camera_move', targetFrameId: resolvedFrameId, targetWidth: width, offsetX, offsetY, follow: null } as CameraMoveItem };
}

/** Resolve camera request descriptors inside a raw `{reply, actions}` envelope (CREATE and UPDATE). */
export function resolveCameraRequests(raw: unknown, context: CameraRequestContext): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const response = raw as Record<string, unknown>;
  if (!Array.isArray(response.actions)) return raw;
  const actions: unknown[] = [];
  const planned = new Map(context.items);
  for (const action of response.actions) {
    if (!action || typeof action !== 'object') { actions.push(action); continue; }
    const candidate = action as Record<string, unknown>;
    const created = candidate.action === 'CREATE' && candidate.item && typeof candidate.item === 'object' ? (candidate.item as Record<string, unknown>) : null;
    if (created && typeof created.id === 'string' && typeof created.kind === 'string') planned.set(created.id, created as unknown as SceneItem);
    if (candidate.action === 'CREATE' && candidate.item && typeof candidate.item === 'object' && (candidate.item as Record<string, unknown>).kind === 'camera_move') {
      const resolved = resolveCameraRequest(candidate.item as Record<string, unknown>, context, planned);
      if (resolved.error) return { ...response, reply: resolved.error, actions: [] };
      actions.push({ ...candidate, item: resolved.item });
      continue;
    }
    if (candidate.action === 'UPDATE' && typeof candidate.itemId === 'string' && candidate.updates && typeof candidate.updates === 'object') {
      const previous = context.items.get(candidate.itemId);
      const updates = candidate.updates as Record<string, unknown>;
      if (previous?.kind === 'camera_move' && typeof updates.targetMode === 'string') {
        const resolved = resolveCameraRequest({ ...previous, ...updates }, context, planned);
        if (resolved.error) return { ...response, reply: resolved.error, actions: [] };
        if (resolved.item) {
          const persistedUpdates = { ...updates };
          delete persistedUpdates.targetMode;
          delete persistedUpdates.targetId;
          delete persistedUpdates.region;
          Object.assign(persistedUpdates, {
            targetFrameId: resolved.item.targetFrameId,
            targetWidth: resolved.item.targetWidth,
            offsetX: resolved.item.offsetX,
            offsetY: resolved.item.offsetY,
            follow: resolved.item.follow ?? null,
          });
          actions.push({ ...candidate, updates: persistedUpdates });
          continue;
        }
      }
    }
    actions.push(action);
  }
  return { ...response, actions };
}
