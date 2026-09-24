import { axesPreviewVisualKey } from '@/lib/axesPreviewRequest';
import {
  fitCameraBounds,
  type CameraBounds,
  type CameraFitResult,
  type CameraPose,
  DEFAULT_CAMERA_PADDING,
} from '@/lib/camera';
import { createProgress } from '@/lib/createPlaybackPreview';
import { frameCenterById } from '@/lib/frameGrid';
import { resolvePosition } from '@/lib/resolvePosition';
import { measuredInkBox } from '@/lib/textSnap';
import type { FrameDef, ItemId, SceneItem, ShapePoint } from '@/types/scene';

export type CameraBoundsResult =
  | {
      ok: true;
      bounds: CameraBounds;
      targetFrameId: ItemId;
      center: { x: number; y: number };
    }
  | {
      ok: false;
      reason: string;
    };

export type CameraObjectFitResult =
  | (Extract<CameraFitResult, { ok: true }> & { targetFrameId: ItemId })
  | Extract<CameraFitResult, { ok: false }>;

function unavailable(reason: string): CameraBoundsResult {
  return { ok: false, reason };
}

function effectStateUnsupported(id: ItemId, items: ReadonlyMap<ItemId, SceneItem>): boolean {
  for (const item of items.values()) {
    if (item.kind === 'exit_animation' && item.targets.some((target) => target.targetId === id)) return true;
    if (item.kind === 'blink_animation' && item.targets.some((target) => target.targetId === id)) return true;
    if (item.kind === 'target_animation' && item.targets.some((target) => target.targetId === id)) return true;
    if (item.kind === 'textLine' && item.animStyle === 'transform') {
      if (item.id === id || item.transformConfig?.sourceLineId === id) return true;
    }
  }
  return false;
}

function rotatePoints(
  points: ShapePoint[],
  center: { x: number; y: number },
  scale: number,
  rotationDeg: number,
): CameraBounds {
  const angle = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rotated = points.map((point) => {
    const x = point.x * scale;
    const y = point.y * scale;
    return {
      x: center.x + x * cos - y * sin,
      y: center.y + x * sin + y * cos,
    };
  });
  return {
    left: Math.min(...rotated.map((point) => point.x)),
    right: Math.max(...rotated.map((point) => point.x)),
    bottom: Math.min(...rotated.map((point) => point.y)),
    top: Math.max(...rotated.map((point) => point.y)),
  };
}

export function cameraObjectSnapshotBounds(
  id: ItemId,
  items: Map<ItemId, SceneItem>,
  frames: readonly FrameDef[],
  startFrameId: ItemId,
  time: number,
): CameraBoundsResult {
  const item = items.get(id);
  if (!item) return unavailable('Selected object was not found.');
  if (
    item.kind !== 'axes' &&
    item.kind !== 'shape' &&
    item.kind !== 'image' &&
    item.kind !== 'textLine'
  ) {
    return unavailable('Only one measured text line, axes, shape, or image can be fitted.');
  }
  if (effectStateUnsupported(id, items)) {
    return unavailable('This object has intro, transform, exit, blink, or accumulated effect state; use a region zoom.');
  }

  const position = resolvePosition(item, items);
  const frameId = 'frameId' in item && item.frameId ? item.frameId : startFrameId;
  if (!frames.some((frame) => frame.id === frameId)) return unavailable('Object frame is missing.');
  const frame = frameCenterById(frames, frameId);
  const center = { x: position.x + frame.x, y: position.y + frame.y };
  if (createProgress(item, time, items) < 1) {
    return unavailable('Object must finish appearing before its bounds can be fitted.');
  }

  if (item.kind === 'axes') {
    const bounds = item.axisPreviewBounds;
    if (!bounds || item.axisPreviewHash !== axesPreviewVisualKey(item)) {
      return unavailable('Axes bounds are missing or stale. Refresh the axes preview or use a region zoom.');
    }
    const edges = [bounds.left, bounds.right, bounds.bottom, bounds.top];
    if (!edges.every(Number.isFinite) || bounds.right <= bounds.left || bounds.top <= bounds.bottom) {
      return unavailable('Axes preview bounds are invalid. Use a region zoom.');
    }
    return {
      ok: true,
      targetFrameId: frameId,
      center,
      bounds: {
        left: bounds.left + center.x,
        right: bounds.right + center.x,
        bottom: bounds.bottom + center.y,
        top: bounds.top + center.y,
      },
    };
  }

  if (item.kind === 'textLine') {
    const local = measuredInkBox(id, position.x, position.y, item.measure, item.scale);
    if (!local) return unavailable('Measured Hebrew ink bounds are unavailable. Use a region zoom.');
    return {
      ok: true,
      targetFrameId: frameId,
      center,
      bounds: {
        left: local.left + frame.x,
        right: local.right + frame.x,
        bottom: local.bottom + frame.y,
        top: local.top + frame.y,
      },
    };
  }

  if (item.kind === 'image') {
    if (![item.width, item.height, item.scale, item.rotationDeg].every(Number.isFinite) || item.width <= 0 || item.height <= 0 || item.scale <= 0) {
      return unavailable('Image geometry is invalid. Use a region zoom.');
    }
    return {
      ok: true,
      targetFrameId: frameId,
      center,
      bounds: rotatePoints(
        [
          { x: -item.width / 2, y: -item.height / 2 },
          { x: item.width / 2, y: -item.height / 2 },
          { x: item.width / 2, y: item.height / 2 },
          { x: -item.width / 2, y: item.height / 2 },
        ],
        center,
        item.scale,
        item.rotationDeg,
      ),
    };
  }

  if (![item.scale, item.rotationDeg].every(Number.isFinite) || item.scale <= 0) {
    return unavailable('Shape geometry is invalid. Use a region zoom.');
  }
  let points: ShapePoint[];
  if (item.shapeType === 'polyline') {
    if (item.points.length === 0 || item.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      return unavailable('Polyline geometry is invalid. Use a region zoom.');
    }
    points = item.points;
  } else if (item.shapeType === 'line' || item.shapeType === 'arrow') {
    if (![item.endX, item.endY].every(Number.isFinite)) {
      return unavailable('Line geometry is invalid. Use a region zoom.');
    }
    points = [
      { x: -item.endX / 2, y: -item.endY / 2 },
      { x: item.endX / 2, y: item.endY / 2 },
    ];
  } else {
    const halfWidth = item.shapeType === 'circle' ? item.radius : item.width / 2;
    const halfHeight = item.shapeType === 'circle' ? item.radius : item.height / 2;
    if (![halfWidth, halfHeight].every(Number.isFinite) || halfWidth <= 0 || halfHeight <= 0) {
      return unavailable('Shape geometry is invalid. Use a region zoom.');
    }
    points = [
      { x: -halfWidth, y: -halfHeight },
      { x: halfWidth, y: -halfHeight },
      { x: halfWidth, y: halfHeight },
      { x: -halfWidth, y: halfHeight },
    ];
  }
  return { ok: true, targetFrameId: frameId, center, bounds: rotatePoints(points, center, item.scale, item.rotationDeg) };
}

export function fitCameraObjectSnapshot(
  id: ItemId,
  items: Map<ItemId, SceneItem>,
  frames: readonly FrameDef[],
  startFrameId: ItemId,
  time: number,
  padding = DEFAULT_CAMERA_PADDING,
): CameraObjectFitResult {
  const snapshot = cameraObjectSnapshotBounds(id, items, frames, startFrameId, time);
  if (!snapshot.ok) return snapshot;
  const fit = fitCameraBounds(snapshot.bounds, padding);
  if (!fit.ok) return fit;
  return { ...fit, targetFrameId: snapshot.targetFrameId };
}

export function cameraSnapshotFromFit(
  fit: Extract<CameraObjectFitResult, { ok: true }>,
): CameraPose {
  return { ...fit.destination };
}
