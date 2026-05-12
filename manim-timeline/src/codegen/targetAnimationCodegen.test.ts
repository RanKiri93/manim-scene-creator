import { describe, expect, it } from 'vitest';
import type { SceneItem } from '@/types/scene';
import {
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
});
