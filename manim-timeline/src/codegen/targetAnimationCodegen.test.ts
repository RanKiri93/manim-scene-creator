import { describe, expect, it } from 'vitest';
import type { SceneItem } from '@/types/scene';
import {
  createImageItem,
  createTargetAnimation,
  createTextLine,
  defaultSceneDefaults,
} from '@/store/factories';
import { formatTargetAnimationClipPlay } from './targetAnimationCodegen';

function mapOf(...items: SceneItem[]): Map<string, SceneItem> {
  return new Map(items.map((it) => [it.id, it]));
}

describe('formatTargetAnimationClipPlay', () => {
  it('exports parametric MoveAlongPath relative to target center', () => {
    const line = createTextLine(defaultSceneDefaults(), 0);
    line.id = 'ln1';
    line.segments = [
      { text: 'hi', isMath: false, color: '#ffffff', bold: false, italic: false },
    ];

    const clip = createTargetAnimation('path', [line.id], 1, 2);
    clip.id = 'ta1';
    clip.targets = [
      {
        targetId: line.id,
        pathKind: 'parametric',
        parametricPath: {
          jsXExpr: 'Math.cos(t)',
          jsYExpr: 'Math.sin(t)',
          pyXExpr: 'np.cos(t)',
          pyYExpr: 'np.sin(t)',
          tMin: 0,
          tMax: Math.PI,
        },
      },
    ];

    const code = formatTargetAnimationClipPlay(
      clip,
      '  ',
      new Map([['ln1', 'line_a']]),
      mapOf(line, clip),
    );

    expect(code).toContain('ParametricFunction(');
    expect(code).toContain('line_a.get_center()');
    expect(code).toContain('(np.cos(t))');
    expect(code).toContain('MoveAlongPath(line_a, ta_path_');
  });

  it('exports image move as a shift animation', () => {
    const img = createImageItem({
      srcUrl: 'blob:img',
      fileName: 'img.png',
      mimeType: 'image/png',
      width: 2,
      height: 1,
    });
    img.id = 'img1';
    const clip = createTargetAnimation('move', [img.id], 1, 1.25);
    clip.targets = [{ targetId: img.id, dx: 1.5, dy: -0.25 }];

    const code = formatTargetAnimationClipPlay(
      clip,
      '',
      new Map([['img1', 'image_a']]),
      mapOf(img, clip),
    );

    expect(code).toContain('image_a.animate.shift(1.500000 * RIGHT + -0.250000 * UP)');
    expect(code).toContain('run_time=1.2500');
  });

  it('exports image polyline path as MoveAlongPath', () => {
    const img = createImageItem({
      srcUrl: 'blob:img',
      fileName: 'img.png',
      mimeType: 'image/png',
      width: 2,
      height: 1,
    });
    img.id = 'img1';
    const clip = createTargetAnimation('path', [img.id], 1, 2);
    clip.id = 'ta_img_path';
    clip.targets = [
      {
        targetId: img.id,
        pathKind: 'polyline',
        pathPoints: [
          { x: 0, y: 0 },
          { x: 1, y: 0.5 },
        ],
      },
    ];

    const code = formatTargetAnimationClipPlay(
      clip,
      '',
      new Map([['img1', 'image_a']]),
      mapOf(img, clip),
    );

    expect(code).toContain('image_a.get_center()');
    expect(code).toContain('set_points_as_corners');
    expect(code).toContain('MoveAlongPath(image_a, ta_path_');
  });

  it('exports image rotate through the image var', () => {
    const img = createImageItem({
      srcUrl: 'blob:img',
      fileName: 'img.png',
      mimeType: 'image/png',
      width: 2,
      height: 1,
    });
    img.id = 'img1';
    const clip = createTargetAnimation('rotate', [img.id], 1, 0.75);
    clip.targets = [{ targetId: img.id, angleDeg: 45 }];

    const code = formatTargetAnimationClipPlay(
      clip,
      '',
      new Map([['img1', 'image_a']]),
      mapOf(img, clip),
    );

    expect(code).toContain('image_a.animate.rotate(45.000000 * DEGREES)');
    expect(code).toContain('run_time=0.7500');
  });
});
