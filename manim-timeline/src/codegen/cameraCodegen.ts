import type {
  CameraPose,
  CameraSchedule,
  CameraTransitionSegment,
} from '@/lib/camera';
import { cameraFollowAnchor } from '@/lib/camera';
import { FRAME_W } from '@/lib/constants';
import type { ItemId, SceneItem } from '@/types/scene';
import { connectorAnchorExpr } from './shapeCodegen';

/** Python expression for a follow target's centre (world coordinates), for camera follow clips. */
export type CameraFollowExpr = (targetId: ItemId) => string;

/** Follow-target expressions resolved like connector anchors (dot centre, object centre). */
export function cameraFollowExprFor(idToVarName: Map<ItemId, string>, itemsMap: Map<ItemId, SceneItem>): CameraFollowExpr {
  return (targetId) => {
    const anchor = cameraFollowAnchor(targetId, itemsMap);
    if (typeof anchor === 'string') throw new Error(anchor);
    return connectorAnchorExpr(anchor, idToVarName, itemsMap, { x: 0, y: 0 });
  };
}

function indent(indentLevel: number): string {
  return ' '.repeat(indentLevel);
}

function number(value: number): string {
  return value.toFixed(6);
}

function vectorExpr(pose: CameraPose): string {
  const parts: string[] = [];
  if (Math.abs(pose.x) > 1e-9) parts.push(`${number(pose.x)} * RIGHT`);
  if (Math.abs(pose.y) > 1e-9) parts.push(`${number(pose.y)} * UP`);
  return parts.length > 0 ? parts.join(' + ') : 'ORIGIN';
}

function poseTupleExpr(pose: CameraPose): string {
  return `(${number(pose.x)}, ${number(pose.y)}, ${number(pose.width)})`;
}

export function cameraPoseAnimationHelperSource(indentLevel = 0): string {
  const pad = indent(indentLevel);
  const inner = indent(indentLevel + 4);
  const body = indent(indentLevel + 8);
  return (
    `class _CameraPoseAnimation(Animation):\n` +
    `${inner}def __init__(self, frame, initial_pose, segments, run_time=1.0):\n` +
    `${body}super().__init__(frame, run_time=run_time, rate_func=linear, remover=False)\n` +
    `${body}self.camera_initial_pose = tuple(initial_pose)\n` +
    `${body}self.camera_segments = segments\n` +
    `${body}self.inner_animation = None\n` +
    `${inner}def begin(self):\n` +
    `${body}super().begin()\n` +
    `${inner}def interpolate_mobject(self, alpha):\n` +
    `${body}time = max(0.0, min(self.get_run_time(), alpha * self.get_run_time()))\n` +
    `${body}pose = self.camera_initial_pose\n` +
    `${body}for segment in self.camera_segments:\n` +
    `${body}    start, nominal_end, effective_end, source, destination = segment[:5]\n` +
    `${body}    if time < start:\n` +
    `${body}        break\n` +
    `${body}    sample_time = min(time, effective_end)\n` +
    `${body}    if len(segment) > 5 and sample_time < nominal_end:\n` +
    // Follow: ease from the source onto the target's live centre, then track it.
    `${body}        centre, blend, (dx, dy, width) = segment[5]()[:2], segment[6], segment[7]\n` +
    `${body}        destination = (centre[0] + dx, centre[1] + dy, width)\n` +
    `${body}        progress = 1.0 if blend <= 0 else max(0.0, min(1.0, (sample_time - start) / blend))\n` +
    `${body}    else:\n` +
    `${body}        progress = max(0.0, min(1.0, (sample_time - start) / (nominal_end - start)))\n` +
    `${body}    eased = progress * progress * (3.0 - 2.0 * progress)\n` +
    `${body}    pose = tuple(source[i] + (destination[i] - source[i]) * eased for i in range(3))\n` +
    `${body}    if time < effective_end:\n` +
    `${body}        break\n` +
    `${body}self.mobject.move_to(pose[0] * RIGHT + pose[1] * UP)\n` +
    `${body}self.mobject.set(width=pose[2])\n` +
    `${pad}\n`
  );
}

export function cameraExportPreconditionNote(indentLevel = 0): string {
  return `${indent(indentLevel)}# Camera export prerequisite: subclass MovingCameraScene and retain the emitted _CameraPoseAnimation helper.\n`;
}

function segmentTupleExpr(
  segment: CameraTransitionSegment,
  originTime: number,
  followExpr?: CameraFollowExpr,
): string {
  let follow = '';
  if (segment.follow) {
    if (!followExpr) throw new Error(`Camera clip "${segment.clip.label || segment.clip.id}" follows an object; export needs its variable.`);
    const clip = segment.clip;
    follow =
      `, lambda: ${followExpr(segment.follow.targetId)}, ${number(segment.follow.blend)}, ` +
      `(${number(clip.offsetX ?? 0)}, ${number(clip.offsetY ?? 0)}, ${number(segment.destination.width)})`;
  }
  return (
    `(${number(segment.startTime - originTime)}, ` +
    `${number(segment.nominalEndTime - originTime)}, ` +
    `${number(segment.effectiveEndTime - originTime)}, ` +
    `${poseTupleExpr(segment.source)}, ${poseTupleExpr(segment.destination)}${follow})`
  );
}

export function formatCameraFrameInitialization(
  schedule: CameraSchedule,
  pad: string,
): string {
  const pose = schedule.initialPose;
  return `${pad}self.camera.frame.move_to(${vectorExpr(pose)})\n${pad}self.camera.frame.set(width=${number(pose.width)})\n`;
}

export function formatStandaloneCameraPlay(
  segment: CameraTransitionSegment,
  pad: string,
  followExpr?: CameraFollowExpr,
): string {
  const runTime = segment.nominalEndTime - segment.startTime;
  return `${pad}self.play(_CameraPoseAnimation(self.camera.frame, ${poseTupleExpr(segment.source)}, [${segmentTupleExpr(segment, segment.startTime, followExpr)}], run_time=${number(runTime)}))\n`;
}

export function formatConcurrentCameraBranch(
  segments: readonly CameraTransitionSegment[],
  clusterStart: number,
  clusterEnd: number,
  initialPose: CameraPose,
  playPad: string,
  followExpr?: CameraFollowExpr,
): string {
  const active = [...segments]
    .filter((segment) =>
      !segment.supersededByEqualStart &&
      segment.startTime < clusterEnd &&
      segment.nominalEndTime > clusterStart,
    )
    .sort((a, b) => a.startTime - b.startTime || a.clip.id.localeCompare(b.clip.id));
  if (active.length === 0) return '';
  const runTime = Math.max(0.05, clusterEnd - clusterStart);
  const segmentList = active
    .map((segment) => segmentTupleExpr(segment, clusterStart, followExpr))
    .join(', ');
  const animation = `_CameraPoseAnimation(self.camera.frame, ${poseTupleExpr(initialPose)}, [${segmentList}], run_time=${number(runTime)})`;
  return `${playPad}${animation}`;
}

export function cameraHasMovingCameraRequirement(
  items: readonly { kind: string }[],
  initialPose: CameraPose,
): boolean {
  return (
    items.some((item) => item.kind === 'camera_move') ||
    Math.abs(initialPose.x) > 1e-9 ||
    Math.abs(initialPose.y) > 1e-9 ||
    Math.abs(initialPose.width - FRAME_W) > 1e-9
  );
}
