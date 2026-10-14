import { describe, expect, it } from 'vitest';
import { defaultSceneDefaults, createAxes, createCameraMove, createFrame, createGraphDotItem, createTextLine } from '@/store/factories';
import { exportMultiSceneCombinedPython, combineMultiScenePythonExports } from '@/codegen/projectExporter';
import { exportManimCode } from '@/codegen/manimExporter';

describe('projectExporter', () => {
  it('isolates generic dot updater and coordinate glyph helpers across mixed-scene exports', () => {
    const d1 = { ...defaultSceneDefaults(), sceneName: 'CoordinatesScene' };
    const d2 = { ...defaultSceneDefaults(), sceneName: 'LabelScene' };
    const a1 = createAxes(d1, 0); a1.id = 'axes_coordinates';
    const dot1 = createGraphDotItem(a1.id); dot1.id = 'dot_coordinates'; dot1.dot.showCoordinates = true;
    const a2 = createAxes(d2, 0); a2.id = 'axes_label';
    const dot2 = createGraphDotItem(a2.id); dot2.id = 'dot_label'; dot2.dot.label = 'A';
    const code = exportMultiSceneCombinedPython([
      { defaults: d1, items: [a1, dot1] },
      { defaults: d2, items: [a2, dot2] },
    ]);
    expect(code).toContain('class CoordinatesScene(Scene):');
    expect(code).toContain('class LabelScene(Scene):');
    expect(code.match(/def _graph_update_dot\(/g)).toHaveLength(1);
    expect(code.match(/_graph_glyphs = \{/g)).toHaveLength(1);
    expect(code.match(/def _graph_coord_text\(/g)).toHaveLength(1);
    expect(code).toContain('dot_coordinates_update');
    expect(code).toContain('dot_label_update');
  });
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

  it('keeps camera schedules independent per scene while deduplicating the shared helper', () => {
    const d1 = { ...defaultSceneDefaults(), sceneName: 'ZoomA' };
    const d2 = { ...defaultSceneDefaults(), sceneName: 'ZoomB' };
    const f1 = createFrame(0, 0, 'A');
    const f2 = createFrame(1, 0, 'B');
    const a = createCameraMove(f1.id, 2, 1);
    a.offsetX = 1;
    a.targetWidth = 5;
    const b = createCameraMove(f2.id, 4, 2);
    b.offsetX = -2;
    b.targetWidth = 7;
    const code = exportMultiSceneCombinedPython([
      { defaults: d1, items: [a], frames: [f1], startFrameId: f1.id },
      { defaults: d2, items: [b], frames: [f2], startFrameId: f2.id },
    ]);
    expect(code).toContain('class ZoomA(MovingCameraScene):');
    expect(code).toContain('class ZoomB(MovingCameraScene):');
    // Each scene's standalone export carries the module helper; duplicate identical definitions
    // remain stateless and cannot leak a scene-specific camera schedule.
    expect(code.match(/class _CameraPoseAnimation\(Animation\):/g)).toHaveLength(2);
    expect(code).toContain('self.wait(2.0000)');
    expect(code).toContain('self.wait(4.0000)');
    expect(code).toContain('(1.000000, 0.000000, 5.000000)');
    expect(code).toContain('(12.222222, 0.000000, 7.000000)');
  });
});
