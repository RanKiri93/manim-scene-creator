import { FRAME_H, FRAME_W } from '@/lib/constants';
import { frameCenterById } from '@/lib/frameGrid';
import type { CameraMoveItem, FrameDef, ItemId, SceneItem, ShapeAnchor } from '@/types/scene';
import { OBJECT_ANCHOR_KINDS, isConnectorShape, resolveShapeAnchor } from '@/lib/shapeAnchors';

export const MIN_CAMERA_DURATION = 0.05;
export const DEFAULT_CAMERA_DURATION = 1;
export const DEFAULT_CAMERA_PADDING = 0.3;

export interface CameraPose {
  x: number;
  y: number;
  width: number;
}

export interface CameraBounds {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

export interface CameraDiagnostic {
  clipId: ItemId;
  message: string;
}

/** A follow clip's live target (see {@link CameraMoveItem.follow}). */
export interface CameraFollow {
  targetId: ItemId;
  /** Camera pose that centres the target at a time (offset and width applied); null if unresolved. */
  poseAt: (time: number) => CameraPose | null;
  /** Seconds over which the camera eases from where it was onto the target. */
  blend: number;
}

/** Ease onto a follow target over this long at most (a third of the clip when shorter). */
export const CAMERA_FOLLOW_BLEND = 0.6;

export interface CameraTransitionSegment {
  clip: CameraMoveItem;
  follow?: CameraFollow;
  source: CameraPose;
  destination: CameraPose;
  startTime: number;
  nominalEndTime: number;
  effectiveEndTime: number;
  overriddenBy: CameraMoveItem | null;
  supersededByEqualStart: CameraMoveItem | null;
}

export interface CameraSchedule {
  initialPose: CameraPose;
  startFrameId: ItemId;
  segments: CameraTransitionSegment[];
  diagnostics: CameraDiagnostic[];
}

export type CameraFitResult =
  | {
      ok: true;
      destination: CameraPose;
      viewport: CameraBounds;
    }
  | {
      ok: false;
      reason: string;
    };

export function cameraEase(progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  return p * p * (3 - 2 * p);
}

export function interpolateCameraPose(
  source: CameraPose,
  destination: CameraPose,
  progress: number,
): CameraPose {
  const p = cameraEase(progress);
  return {
    x: source.x + (destination.x - source.x) * p,
    y: source.y + (destination.y - source.y) * p,
    width: source.width + (destination.width - source.width) * p,
  };
}

export function fitCameraBounds(
  rawBounds: CameraBounds,
  padding = 0,
): CameraFitResult {
  const values = [rawBounds.left, rawBounds.right, rawBounds.bottom, rawBounds.top];
  if (!values.every(Number.isFinite)) return { ok: false, reason: 'Region edges must be finite.' };
  const left = Math.min(rawBounds.left, rawBounds.right);
  const right = Math.max(rawBounds.left, rawBounds.right);
  const bottom = Math.min(rawBounds.bottom, rawBounds.top);
  const top = Math.max(rawBounds.bottom, rawBounds.top);
  if (right - left <= 1e-6 || top - bottom <= 1e-6) {
    return { ok: false, reason: 'Drag a region with positive width and height.' };
  }
  const pad = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  const padded = { left: left - pad, right: right + pad, bottom: bottom - pad, top: top + pad };
  const width = Math.max(
    padded.right - padded.left,
    (padded.top - padded.bottom) * (FRAME_W / FRAME_H),
  );
  const x = (padded.left + padded.right) / 2;
  const y = (padded.bottom + padded.top) / 2;
  return {
    ok: true,
    destination: { x, y, width },
    viewport: {
      left: x - width / 2,
      right: x + width / 2,
      bottom: y - (width * FRAME_H / FRAME_W) / 2,
      top: y + (width * FRAME_H / FRAME_W) / 2,
    },
  };
}

function legacyTargetWidth(clip: CameraMoveItem): number {
  const raw = (clip as CameraMoveItem & { targetWidth?: unknown }).targetWidth;
  return raw == null ? FRAME_W : raw as number;
}

export function resolveCameraTargetWidth(clip: CameraMoveItem): number {
  return legacyTargetWidth(clip);
}

/** Anchor whose world position a follow clip tracks, or an error for targets it cannot follow. */
export function cameraFollowAnchor(targetId: ItemId, items: ReadonlyMap<ItemId, SceneItem>): ShapeAnchor | string {
  const target = items.get(targetId);
  if (!target) return `Camera follow target "${targetId}" is missing.`;
  if (target.kind === 'graphDot') return { kind: 'graphDot', dotId: targetId };
  if (OBJECT_ANCHOR_KINDS.has(target.kind) && !isConnectorShape(target)) return { kind: 'object', itemId: targetId };
  return `Camera can follow a graph dot, text line, shape, image or axes, not a ${target.kind}.`;
}

function followFor(
  clip: CameraMoveItem,
  items: ReadonlyMap<ItemId, SceneItem>,
  frames: readonly FrameDef[],
  startFrameId: ItemId,
): CameraFollow | null {
  if (!clip.follow) return null;
  const anchor = cameraFollowAnchor(clip.follow.targetId, items);
  if (typeof anchor === 'string') return null;
  const width = legacyTargetWidth(clip);
  return {
    targetId: clip.follow.targetId,
    blend: Math.min(CAMERA_FOLLOW_BLEND, clip.duration / 3),
    poseAt: (time) => {
      const r = resolveShapeAnchor(anchor, clip as unknown as SceneItem, { items: items as Map<ItemId, SceneItem>, time, frames, startFrameId });
      return r.error != null ? null : { x: r.point.x + (clip.offsetX ?? 0), y: r.point.y + (clip.offsetY ?? 0), width };
    },
  };
}

export function validateCameraMove(
  clip: CameraMoveItem,
  frames: readonly FrameDef[],
  items?: ReadonlyMap<ItemId, SceneItem>,
): CameraDiagnostic[] {
  const out: CameraDiagnostic[] = [];
  if (clip.follow && items) {
    const anchor = cameraFollowAnchor(clip.follow.targetId, items);
    if (typeof anchor === 'string') out.push({ clipId: clip.id, message: anchor });
    else {
      const target = items.get(clip.follow.targetId)!;
      const shown = 'startTime' in target && typeof target.startTime === 'number' ? target.startTime : 0;
      if (shown > clip.startTime + 1e-6) {
        out.push({ clipId: clip.id, message: `Camera follow starts at ${clip.startTime.toFixed(2)}s, before "${clip.follow.targetId}" appears (${shown.toFixed(2)}s).` });
      }
    }
  }
  const rawWidth = (clip as CameraMoveItem & { targetWidth?: unknown }).targetWidth;
  if (rawWidth != null && (typeof rawWidth !== 'number' || !Number.isFinite(rawWidth) || rawWidth <= 0)) {
    out.push({ clipId: clip.id, message: 'Camera target width must be finite and greater than zero.' });
  }
  if (!Number.isFinite(clip.startTime) || clip.startTime < 0) {
    out.push({ clipId: clip.id, message: 'Camera start time must be finite and non-negative.' });
  }
  if (!Number.isFinite(clip.duration) || clip.duration < MIN_CAMERA_DURATION) {
    out.push({ clipId: clip.id, message: `Camera duration must be at least ${MIN_CAMERA_DURATION}s.` });
  }
  if (!frames.some((frame) => frame.id === clip.targetFrameId)) {
    out.push({ clipId: clip.id, message: 'Camera target frame is missing.' });
  }
  if ((clip.offsetX != null && !Number.isFinite(clip.offsetX)) || (clip.offsetY != null && !Number.isFinite(clip.offsetY))) {
    out.push({ clipId: clip.id, message: 'Camera offsets must be finite.' });
  }
  return out;
}

export function cameraMovesFromItems(
  items: ReadonlyMap<ItemId, SceneItem> | readonly SceneItem[],
  excludedIds?: ReadonlySet<ItemId>,
): CameraMoveItem[] {
  const values: readonly SceneItem[] = Array.isArray(items)
    ? items
    : Array.from((items as ReadonlyMap<ItemId, SceneItem>).values());
  return values.filter(
    (item): item is CameraMoveItem =>
      item.kind === 'camera_move' && !excludedIds?.has(item.id),
  );
}

export function resolveCameraSchedule(
  items: ReadonlyMap<ItemId, SceneItem> | readonly SceneItem[],
  frames: readonly FrameDef[],
  startFrameId: ItemId,
  excludedIds?: ReadonlySet<ItemId>,
): CameraSchedule {
  const initialCenter = frameCenterById(frames, startFrameId);
  const initialPose: CameraPose = { ...initialCenter, width: FRAME_W };
  const itemMap: ReadonlyMap<ItemId, SceneItem> = Array.isArray(items)
    ? new Map((items as readonly SceneItem[]).map((it) => [it.id, it]))
    : (items as ReadonlyMap<ItemId, SceneItem>);
  const clips = cameraMovesFromItems(items, excludedIds).sort(
    (a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id),
  );
  const diagnostics: CameraDiagnostic[] = [];
  const segments: CameraTransitionSegment[] = [];
  let current = initialPose;

  for (let i = 0; i < clips.length;) {
    const groupStart = clips[i]!.startTime;
    let end = i + 1;
    while (end < clips.length && clips[end]!.startTime === groupStart) end += 1;
    const group = clips.slice(i, end);
    const winner = group[group.length - 1]!;
    const groupDiagnostics = group.flatMap((clip) => validateCameraMove(clip, frames, itemMap));
    diagnostics.push(...groupDiagnostics);
    const winnerDiagnostics = groupDiagnostics.filter((diagnostic) => diagnostic.clipId === winner.id);
    if (winnerDiagnostics.length === 0) {
      const targetCenter = frameCenterById(frames, winner.targetFrameId);
      const follow = followFor(winner, itemMap, frames, startFrameId);
      // A follow clip ends wherever its target is at the clip's end.
      const destination: CameraPose = follow?.poseAt(groupStart + winner.duration) ?? {
        x: targetCenter.x + (winner.offsetX ?? 0),
        y: targetCenter.y + (winner.offsetY ?? 0),
        width: legacyTargetWidth(winner),
      };
      const segment: CameraTransitionSegment = {
        clip: winner,
        ...(follow ? { follow } : {}),
        source: { ...current },
        destination,
        startTime: groupStart,
        nominalEndTime: groupStart + winner.duration,
        effectiveEndTime: groupStart + winner.duration,
        overriddenBy: null,
        supersededByEqualStart: null,
      };
      segments.push(segment);
      for (let k = 0; k < group.length - 1; k += 1) {
        segments.push({
          clip: group[k]!,
          source: { ...current },
          destination: {
            ...frameCenterById(frames, group[k]!.targetFrameId),
            width: legacyTargetWidth(group[k]!),
          },
          startTime: groupStart,
          nominalEndTime: groupStart + group[k]!.duration,
          effectiveEndTime: groupStart,
          overriddenBy: null,
          supersededByEqualStart: winner,
        });
      }
      current = destination;
    } else {
      for (const loser of group.slice(0, -1)) {
        segments.push({
          clip: loser,
          source: { ...current },
          destination: {
            ...frameCenterById(frames, loser.targetFrameId),
            width: legacyTargetWidth(loser),
          },
          startTime: groupStart,
          nominalEndTime: groupStart + loser.duration,
          effectiveEndTime: groupStart,
          overriddenBy: null,
          supersededByEqualStart: winner,
        });
      }
    }
    i = end;
  }

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]!;
    if (segment.supersededByEqualStart) continue;
    const next = segments
      .slice(i + 1)
      .find((candidate) => !candidate.supersededByEqualStart);
    if (!next || next.startTime >= segment.nominalEndTime) continue;
    const sampled = cameraPoseInSegment(segment, next.startTime);
    segment.effectiveEndTime = next.startTime;
    segment.overriddenBy = next.clip;
    next.source = { ...sampled };
  }

  return { initialPose, startFrameId, segments, diagnostics };
}

function cameraPoseInSegment(segment: CameraTransitionSegment, time: number): CameraPose {
  if (time >= segment.nominalEndTime) return { ...segment.destination };
  if (time <= segment.startTime) return { ...segment.source };
  if (segment.follow) {
    const live = segment.follow.poseAt(time) ?? segment.destination;
    const blend = segment.follow.blend > 0 ? (time - segment.startTime) / segment.follow.blend : 1;
    return interpolateCameraPose(segment.source, live, Math.min(1, blend));
  }
  return interpolateCameraPose(
    segment.source,
    segment.destination,
    (time - segment.startTime) / (segment.nominalEndTime - segment.startTime),
  );
}

export function cameraPoseAtTime(
  time: number,
  items: ReadonlyMap<ItemId, SceneItem> | readonly SceneItem[],
  frames: readonly FrameDef[],
  startFrameId: ItemId,
  excludedIds?: ReadonlySet<ItemId>,
): CameraPose {
  const schedule = resolveCameraSchedule(items, frames, startFrameId, excludedIds);
  return cameraPoseFromSchedule(time, schedule);
}

export function cameraPoseFromSchedule(time: number, schedule: CameraSchedule): CameraPose {
  let current = { ...schedule.initialPose };
  for (const segment of schedule.segments) {
    if (segment.supersededByEqualStart) continue;
    if (time < segment.startTime) break;
    current = cameraPoseInSegment(segment, time);
  }
  return current;
}

export function logicalCameraFrameAtTime(
  time: number,
  schedule: CameraSchedule,
): ItemId {
  let frameId = schedule.startFrameId;
  for (const segment of schedule.segments) {
    if (segment.supersededByEqualStart) continue;
    if (segment.overriddenBy && segment.nominalEndTime > segment.overriddenBy.startTime) continue;
    if (time >= segment.nominalEndTime) frameId = segment.clip.targetFrameId;
  }
  return frameId;
}

export function cameraTargetDiagnostic(
  clip: CameraMoveItem,
  frames: readonly FrameDef[],
): CameraDiagnostic | null {
  return validateCameraMove(clip, frames)[0] ?? null;
}
