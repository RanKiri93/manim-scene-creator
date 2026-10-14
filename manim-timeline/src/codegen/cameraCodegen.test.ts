import { describe, expect, it } from 'vitest';
import { createCameraMove, createFrame, defaultSceneDefaults } from '@/store/factories';
import { exportManimCode } from './manimExporter';
import {
  cameraPoseAnimationHelperSource,
  formatCameraFrameInitialization,
  formatStandaloneCameraPlay,
} from './cameraCodegen';
import { resolveCameraSchedule } from '@/lib/camera';
import { FRAME_W } from '@/lib/constants';
import { sequentialAnimSecondsForCameraMove } from './groupPlaybackSpan';

describe('camera viewport emission', () => {
  it('emits a deterministic explicit cubic evaluator with original and effective end times', () => {
    const source = cameraPoseAnimationHelperSource();
    expect(source).toContain('progress = max(0.0, min(1.0, (sample_time - start) / (nominal_end - start)))');
    expect(source).toContain('eased = progress * progress * (3.0 - 2.0 * progress)');
    expect(source).toContain('for start, nominal_end, effective_end, source, destination in self.camera_segments:');
    expect(source).toContain('super().begin()');
  });

  it('emits an absolute-width standalone move and exact authored runtime', () => {
    const home = createFrame(0, 0, 'Home');
    const camera = createCameraMove(home.id, 2, 1.25);
    camera.offsetX = 3;
    camera.targetWidth = 7;
    const schedule = resolveCameraSchedule([camera], [home], home.id);
    expect(formatStandaloneCameraPlay(schedule.segments[0]!, '')).toBe(
      'self.play(_CameraPoseAnimation(self.camera.frame, (0.000000, 0.000000, 14.222222), [(0.000000, 1.250000, 1.250000, (0.000000, 0.000000, 14.222222), (3.000000, 0.000000, 7.000000))], run_time=1.250000))\n',
    );
  });

  it('matches the shared 0.05-second authored minimum in emitted runtime accounting', () => {
    const frame = createFrame(0, 0, 'Home');
    const camera = createCameraMove(frame.id, 0, 0.05);
    const schedule = resolveCameraSchedule([camera], [frame], frame.id);
    expect(sequentialAnimSecondsForCameraMove(camera)).toBe(0.05);
    expect(formatStandaloneCameraPlay(schedule.segments[0]!, '')).toContain('run_time=0.050000');
  });

  it('resets to full-frame width at the non-origin owning frame', () => {
    const home = createFrame(1, 2, 'Non-origin');
    const schedule = resolveCameraSchedule([], [home], home.id);
    expect(schedule.initialPose).toEqual({ x: 14.222222222222221, y: -16, width: FRAME_W });
    expect(formatCameraFrameInitialization(schedule, '    ')).toContain('set(width=14.222222)');
  });

  it('includes helper and precondition in partial export and uses absolute target width', () => {
    const defaults = defaultSceneDefaults();
    const frame = createFrame(0, 0, 'Home');
    const camera = createCameraMove(frame.id, 0, 2);
    camera.targetWidth = 5;
    const code = exportManimCode([camera], {
      fullFile: false,
      defaults,
      frames: [frame],
      startFrameId: frame.id,
    });
    expect(code).toContain('subclass MovingCameraScene');
    expect(code).toContain('class _CameraPoseAnimation(Animation):');
    expect(code).toContain('set(width=14.222222)');
    expect(code).toContain('(0.000000, 0.000000, 5.000000)');
    expect(code).not.toContain('.scale(');
  });

  it('rejects malformed camera target width with an actionable diagnostic', () => {
    const defaults = defaultSceneDefaults();
    const frame = createFrame(0, 0, 'Home');
    const camera = createCameraMove(frame.id, 0, 1);
    camera.targetWidth = Number.NaN;
    const code = exportManimCode([camera], {
      fullFile: true,
      defaults,
      frames: [frame],
      startFrameId: frame.id,
    });
    expect(code).toContain('Camera target width must be finite and greater than zero');
  });
});
