import { describe, expect, it } from 'vitest';
import { resolveCameraSchedule } from '@/lib/camera';
import { createCameraMove, createFrame } from '@/store/factories';
import { cameraClipPresentation, cameraPreviewDeletedIds } from './cameraClipPresentation';

const home = createFrame(0, 0, 'Home');
const right = createFrame(1, 0, 'Right');
const frames = [home, right];

function camera(id: string, start: number, duration: number, frameId = right.id) {
  const item = createCameraMove(frameId, start, duration);
  item.id = id;
  item.targetWidth = 4;
  return item;
}

describe('camera override presentation', () => {
  it('marks only the effective interrupted interval and names the winner', () => {
    const a = camera('A', 0, 10);
    const b = camera('B', 2, 1, home.id);
    const schedule = resolveCameraSchedule([a, b], frames, home.id);
    const presentation = cameraClipPresentation(a, schedule);
    expect(presentation.overridden).toBe(true);
    expect(presentation.effectiveEnd).toBe(2);
    expect(presentation.overrideStart).toBe(2);
    expect(presentation.winnerLabel).toBe('Zoom to region');
  });

  it('marks the full bar for an equal-start loser', () => {
    const a = camera('A', 0, 3);
    const b = camera('B', 0, 1, home.id);
    const schedule = resolveCameraSchedule([b, a], frames, home.id);
    const presentation = cameraClipPresentation(a, schedule);
    expect(presentation.superseded).toBe(true);
    expect(presentation.effectiveStart).toBe(0);
    expect(presentation.effectiveEnd).toBe(0);
    expect(presentation.winnerLabel).toBe('Zoom to region');
  });

  it('has no marker for an uninterrupted clip and filters delete-marked preview items', () => {
    const a = camera('A', 0, 1);
    const b = camera('B', 2, 1, home.id);
    const deleted = new Map([['deleted', 'delete']]);
    const schedule = resolveCameraSchedule([a, b], frames, home.id, cameraPreviewDeletedIds(deleted));
    expect(cameraClipPresentation(a, schedule).overridden).toBe(false);
    expect(schedule.segments.some((segment) => segment.clip.id === 'deleted')).toBe(false);
  });
});
