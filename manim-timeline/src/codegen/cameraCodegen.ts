import type {
  CameraPose,
  CameraSchedule,
  CameraTransitionSegment,
} from '@/lib/camera';
import { FRAME_W } from '@/lib/constants';

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
    `${body}self.inner_animation = None\n` +
    `${inner}def interpolate_mobject(self, alpha):\n` +
    `${body}time = max(0.0, min(self.get_run_time(), alpha * self.get_run_time()))\n` +
    `${body}pose = self.camera_initial_pose\n` +
    `${body}for start, nominal_end, source, destination in self.camera_segments:\n` +
    `${body}    if time < start:\n` +
    `${body}        break\n` +
    `${body}    if time >= nominal_end:\n` +
    `${body}        pose = destination\n` +
    `${body}        continue\n` +
    `${body}    progress = max(0.0, min(1.0, (time - start) / (nominal_end - start)))\n` +
    `${body}    eased = progress * progress * (3.0 - 2.0 * progress)\n` +
    `${body}    pose = tuple(source[i] + (destination[i] - source[i]) * eased for i in range(3))\n` +
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
): string {
  return (
    `(${number(segment.startTime - originTime)}, ` +
    `${number(segment.nominalEndTime - originTime)}, ` +
    `${poseTupleExpr(segment.source)}, ${poseTupleExpr(segment.destination)})`
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
): string {
  const runTime = segment.nominalEndTime - segment.startTime;
  return `${pad}self.play(_CameraPoseAnimation(self.camera.frame, ${poseTupleExpr(segment.source)}, [${segmentTupleExpr(segment, segment.startTime)}], run_time=${number(runTime)}))\n`;
}

export function formatConcurrentCameraBranch(
  segments: readonly CameraTransitionSegment[],
  clusterStart: number,
  playPad: string,
): string {
  const active = [...segments]
    .filter((segment) => !segment.supersededByEqualStart)
    .sort((a, b) => a.startTime - b.startTime || a.clip.id.localeCompare(b.clip.id));
  if (active.length === 0) return '';
  const cameraStart = active[0]!.startTime;
  const cameraEnd = Math.max(...active.map((segment) => segment.nominalEndTime));
  const runTime = cameraEnd - cameraStart;
  const relWait = Math.max(0, cameraStart - clusterStart);
  const tuple = segmentTupleExpr(active[0]!, cameraStart);
  const initialPose = poseTupleExpr(active[0]!.source);
  const segmentList = active
    .map((segment) => segmentTupleExpr(segment, cameraStart))
    .join(', ');
  const animation = `_CameraPoseAnimation(self.camera.frame, ${initialPose}, [${segmentList}], run_time=${number(runTime)})`;
  return `${playPad}Succession(Wait(${relWait.toFixed(4)}), ${animation})\n`;
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
