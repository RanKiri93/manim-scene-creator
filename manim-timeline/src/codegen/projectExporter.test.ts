import { describe, expect, it } from 'vitest';
import { defaultSceneDefaults, createTextLine } from '@/store/factories';
import { exportMultiSceneCombinedPython, combineMultiScenePythonExports } from '@/codegen/projectExporter';
import { exportManimCode } from '@/codegen/manimExporter';

describe('projectExporter', () => {
  it('combineMultiScenePythonExports deduplicates shared header lines and keeps each class', () => {
    const a = `from manim import *\nimport numpy as np\n\nclass FirstScene(Scene):\n    def construct(self):\n        pass\n`;
    const b = `from manim import *\nimport cv2\n\nclass SecondScene(Scene):\n    def construct(self):\n        pass\n`;
    const merged = combineMultiScenePythonExports([a, b]);
    expect(merged).toContain('class FirstScene(Scene):');
    expect(merged).toContain('class SecondScene(Scene):');
    expect(merged.split('from manim import *').length - 1).toBe(1);
    expect(merged).toContain('import numpy as np');
    expect(merged).toContain('import cv2');
  });

  it('exportMultiSceneCombinedPython emits multiple scene classes in order', () => {
    const d1 = { ...defaultSceneDefaults(), sceneName: 'AlphaScene' };
    const d2 = { ...defaultSceneDefaults(), sceneName: 'BetaScene' };
    const line1 = createTextLine(d1, 0);
    line1.raw = 'hello';
    const line2 = createTextLine(d2, 0);
    line2.raw = 'world';
    const code = exportMultiSceneCombinedPython([
      { defaults: d1, items: [line1] },
      { defaults: d2, items: [line2] },
    ]);
    const iAlpha = code.indexOf('class AlphaScene');
    const iBeta = code.indexOf('class BetaScene');
    expect(iAlpha).toBeGreaterThan(-1);
    expect(iBeta).toBeGreaterThan(-1);
    expect(iAlpha).toBeLessThan(iBeta);
  });

  it('matches concatenation of two standalone full-file exports', () => {
    const d1 = { ...defaultSceneDefaults(), sceneName: 'S1' };
    const d2 = { ...defaultSceneDefaults(), sceneName: 'S2' };
    const l1 = createTextLine(d1);
    const l2 = createTextLine(d2);
    const p1 = exportManimCode([l1], { fullFile: true, defaults: d1 });
    const p2 = exportManimCode([l2], { fullFile: true, defaults: d2 });
    const manual = combineMultiScenePythonExports([p1, p2]);
    const helper = exportMultiSceneCombinedPython([
      { defaults: d1, items: [l1] },
      { defaults: d2, items: [l2] },
    ]);
    expect(helper.replace(/\s+/g, ' ').trim()).toBe(manual.replace(/\s+/g, ' ').trim());
  });
});
