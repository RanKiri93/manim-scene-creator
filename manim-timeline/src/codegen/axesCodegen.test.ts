import { describe, expect, it } from 'vitest';
import { exportManimCode } from './manimExporter';
import { generateAxesDef } from './graphCodegen';
import { createAxes, createExitAnimation, defaultSceneDefaults } from '@/store/factories';

describe('axes labels in export', () => {
  it('builds labels with HebrewMathLine where the preview raster puts them, as axes submobjects', () => {
    const axes = createAxes(defaultSceneDefaults(), 0);
    const def = generateAxesDef(axes, 'axes_1', 8);
    expect(def).toContain('axes_1_xlabel = HebrewMathLine("x", font_size=36, hebrew_font="Alef")');
    expect(def).toContain('axes_1_xlabel.next_to(axes_1.x_axis.get_end(), DOWN, buff=0.25)');
    expect(def).toContain('axes_1_ylabel.next_to(axes_1.y_axis.get_end(), LEFT, buff=0.25)');
    expect(def).toContain('axes_1.add(axes_1_xlabel, axes_1_ylabel)');
    expect(def).not.toContain('get_x_axis_label');
  });

  it('omits empty labels', () => {
    const axes = createAxes(defaultSceneDefaults(), 0);
    axes.xLabel = '  ';
    axes.yLabel = '';
    const def = generateAxesDef(axes, 'axes_1', 8);
    expect(def).not.toContain('HebrewMathLine');
    expect(def).not.toContain('.add(');
  });

  it('labels come in with Create(axes) and go out with its exit', () => {
    const defaults = defaultSceneDefaults();
    const axes = createAxes(defaults, 0);
    axes.id = 'ax';
    const exit = createExitAnimation([axes.id], 3);
    exit.duration = 1;
    const code = exportManimCode([axes, exit], { fullFile: true, defaults });
    const defAt = code.indexOf('_xlabel = HebrewMathLine');
    const moveAt = code.search(/axes_\w+\.move_to\(/);
    expect(defAt).toBeGreaterThan(-1);
    // Labels join the axes before it is positioned, so the group is centered like the raster.
    expect(defAt).toBeLessThan(moveAt);
    expect(code).toMatch(/self\.play\(Create\(axes_\w+\), run_time=2\)/);
    expect(code).not.toMatch(/self\.add\([^)]*_xlabel/);
  });

  it('scene-start axes are added once, labels included', () => {
    const defaults = defaultSceneDefaults();
    const axes = createAxes(defaults, 0);
    axes.visibleAtSceneStart = true;
    const code = exportManimCode([axes], { fullFile: true, defaults });
    expect(code).not.toMatch(/self\.add\([^)]*_xlabel/);
    expect(code).toMatch(/self\.add\(axes_\w+\)/);
  });
});
