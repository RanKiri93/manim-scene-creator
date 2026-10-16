import { describe, expect, it } from 'vitest';
import { createAxes, createCameraMove, createGraphDotItem, createGraphPlot, createShape, createTargetAnimation, defaultSceneDefaults } from '@/store/factories';
import type { SceneItem } from '@/types/scene';
import { exportManimCode } from './manimExporter';
import { cameraPoseAnimationHelperSource } from './cameraCodegen';

function scene(follow = true): SceneItem[] {
  const axes = { ...createAxes(defaultSceneDefaults()), id: 'ax', startTime: 0, duration: 1, xRange: [0, 20, 5], yRange: [0, 2, 1], scaleX: 0.6 } as SceneItem;
  const plot = createGraphPlot('ax', 1);
  plot.id = 'p';
  plot.fn = { ...plot.fn, jsExpr: '0.1*x', pyExpr: '0.1*x' };
  plot.xDomain = [0, 20];
  const dot = createGraphDotItem('ax', 2);
  dot.id = 'd';
  dot.duration = 0.5;
  dot.dot.attachment = { kind: 'function', graphPlotId: 'p', x: 0 };
  const move = createTargetAnimation('graphFollow', ['d'], 3, 4);
  move.id = 'm';
  move.targets[0] = { targetId: 'd', targetX: 20, easing: 'linear' };
  const cam = createCameraMove('home', 3, 4);
  cam.id = 'c';
  cam.targetWidth = 5;
  cam.offsetY = 0.5;
  if (follow) cam.follow = { targetId: 'd' };
  return [axes, plot, dot, move, cam];
}

const code = (items: SceneItem[]) =>
  exportManimCode(items, { fullFile: true, defaults: defaultSceneDefaults(), frames: [{ id: 'home', col: 0, row: 0 }], startFrameId: 'home' });

describe('camera follow in export', () => {
  it('tracks the dot live inside the motion cluster, with blend, offset and width', () => {
    const py = code(scene());
    expect(py).not.toContain('EXPORT ERROR');
    expect(py).toMatch(/_CameraPoseAnimation\(self\.camera\.frame, [^\n]*, lambda: axes_\w+_dot_d\.get_center\(\), 0\.600000, \(0\.000000, 0\.500000, 5\.000000\)\)\]/);
  });

  it('teaches the pose animation to follow while the segment runs', () => {
    const src = cameraPoseAnimationHelperSource(0);
    expect(src).toContain('start, nominal_end, effective_end, source, destination = segment[:5]');
    expect(src).toContain('if len(segment) > 5 and sample_time < nominal_end:');
    expect(src).toContain('centre, blend, (dx, dy, width) = segment[5]()[:2], segment[6], segment[7]');
  });

  it('keeps ordinary camera clips as plain five-part segments', () => {
    expect(code(scene(false))).not.toContain('lambda: axes_');
  });

  it('follows an object in a standalone camera play too', () => {
    const shape = { ...createShape(0), id: 's', startTime: 0, duration: 0.5 } as SceneItem;
    const cam = createCameraMove('home', 2, 1);
    cam.id = 'c2';
    cam.follow = { targetId: 's' };
    const py = code([shape, cam]);
    expect(py).toMatch(/self\.play\(_CameraPoseAnimation\(self\.camera\.frame, .*lambda: \w+\.get_center\(\), 0\.333333, /);
  });
});
