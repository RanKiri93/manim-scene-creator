import { describe, expect, it } from 'vitest';
import { createShape, defaultSceneDefaults } from '@/store/factories';
import type { SceneItem, ShapeItem } from '@/types/scene';
import { exportManimCode } from './manimExporter';
import { ANGLE_MARK_FN, TICK_MARKS_FN } from './shapeCodegen';

function points(): ShapeItem[] {
  return ['A', 'B', 'C'].map((id, i) => ({
    ...createShape(i * 0.5),
    id,
    label: id,
    shapeType: 'circle',
    radius: 0.06,
    duration: 0.5,
    x: [0, 0, 2][i]!,
    y: [2, 0, 0][i]!,
  }));
}
const side = (id: string, from: string, to: string, ticks?: number): ShapeItem => ({
  ...createShape(2),
  id,
  shapeType: 'line',
  duration: 0.5,
  endpoints: { start: { kind: 'object', itemId: from }, end: { kind: 'object', itemId: to }, ...(ticks ? { ticks } : {}) },
});
const angle = (id: string, mark?: 'arc' | 'right' | 'auto'): ShapeItem => ({
  ...createShape(3),
  id,
  shapeType: 'polyline',
  duration: 0.5,
  angle: { vertex: { kind: 'object', itemId: 'B' }, from: { kind: 'object', itemId: 'A' }, to: { kind: 'object', itemId: 'C' }, radius: 0.35, ...(mark ? { mark } : {}) },
});

const code = (items: SceneItem[]) => exportManimCode(items, { fullFile: true, defaults: defaultSceneDefaults() });

describe('geometry marks in export', () => {
  it('binds an angle mark to its three points with a redraw updater', () => {
    const py = code([...points(), angle('m')]);
    expect(py).not.toContain('EXPORT ERROR');
    expect(py).toContain(`def ${ANGLE_MARK_FN}(v, p1, p2, r, mode):`);
    expect(py).toMatch(/_pts = _angle_mark_points\((\w+)\.get_center\(\), (\w+)\.get_center\(\), (\w+)\.get_center\(\), 0\.350000, "auto"\)/);
    expect(py).toMatch(/m\.become\(VMobject\(color=m\.get_color\(\), stroke_width=[\d.]+\)\.set_points_as_corners\(_pts\)\)/);
    expect(py).toMatch(/self\.add\(_\w+_driver\)/);
    // Placeholder, not placed like a polyline.
    expect(py).toMatch(/= VMobject\(color=ManimColor\("#[0-9a-f]+"\), stroke_width=[\d.]+\)\.set_points_as_corners\(\[ORIGIN, RIGHT \* 0\.001\]\)/i);
    expect(py).not.toContain('_path.set_points_as_corners');
  });

  it('draws ticks with the connector line every frame', () => {
    const py = code([...points(), side('ab', 'A', 'B', 2)]);
    expect(py).toContain(`def ${TICK_MARKS_FN}(a, b, n, color, width):`);
    // A fixed group (line + 2 ticks) redrawn part by part (become into a group would recurse).
    expect(py).toMatch(/= VGroup\(Line\(ORIGIN, RIGHT \* 0\.001, [^\n]*\), Line\(ORIGIN, RIGHT \* 0\.001, [^\n]*\), Line\(ORIGIN, RIGHT \* 0\.001, [^\n]*\)\)\n/);
    expect(py).toMatch(/_parts = \[Line\(_a, _b, color=m\[0\]\.get_color\(\), stroke_width=[\d.]+\)\] \+ _tick_marks\(_a, _b, 2, m\[0\]\.get_color\(\), [\d.]+\)/);
    expect(py).toContain('for _old, _new in zip(m.submobjects, _parts):');
    expect(py).not.toMatch(/m\.become\(VGroup/);
    expect(code([...points(), side('ab', 'A', 'B')])).not.toContain(TICK_MARKS_FN);
  });

  it('passes the forced mark style and reports a missing point', () => {
    expect(code([...points(), angle('m', 'right')])).toContain('"right")');
    expect(code([...points().slice(1), angle('m')])).toMatch(/EXPORT ERROR: Angle mark "[^"]*": Connector anchor "A" must be an exported text line, shape, image or axes/);
  });
});
