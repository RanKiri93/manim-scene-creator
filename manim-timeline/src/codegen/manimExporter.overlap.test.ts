import { describe, expect, it } from 'vitest';
import { exportManimCode } from './manimExporter';
import {
  createAxes,
  createGraphPlot,
  createShape,
  createSurroundingRect,
  createTextLine,
  defaultSceneDefaults,
} from '@/store/factories';

const seg = (text: string) =>
  ({
    text,
    isMath: true,
    color: '#ffffff',
    bold: false,
    italic: false,
  }) as const;

describe('exportManimCode concurrent overlap (composable leaves)', () => {
  it('emits graph plot() after axes positioning so coords_to_point uses the final pose', () => {
    const defaults = defaultSceneDefaults();
    const ax = createAxes(defaults, 0);
    ax.x = 2.5;
    ax.y = -1.25;
    const plot = createGraphPlot(ax.id, 0);
    plot.fn.pyExpr = 'x';

    const code = exportManimCode([ax, plot], {
      fullFile: true,
      defaults,
      audioItems: [],
    });

    const defStart = code.indexOf('# ========== 1. Definitions ==========');
    const posStart = code.indexOf('# ========== 2. Positioning ==========');
    const playStart = code.indexOf('# ========== 3. Playback ==========');
    expect(defStart).toBeGreaterThan(-1);
    expect(posStart).toBeGreaterThan(-1);
    expect(playStart).toBeGreaterThan(-1);

    const defBlock = code.slice(defStart, posStart);
    const posBlock = code.slice(posStart, playStart);
    expect(defBlock).not.toMatch(/\.plot\(/);
    expect(posBlock).toMatch(/\.plot\(/);
    expect(posBlock.indexOf('.move_to(')).toBeLessThan(posBlock.indexOf('.plot('));
  });

  it('emits plot x_range when graph plot has xDomain', () => {
    const defaults = defaultSceneDefaults();
    const ax = createAxes(defaults, 0);
    const plot = createGraphPlot(ax.id, 0);
    plot.fn.pyExpr = 'x';
    plot.xDomain = [0, 2];

    const code = exportManimCode([ax, plot], {
      fullFile: true,
      defaults,
      audioItems: [],
    });

    expect(code).toContain('x_range=[0, 2]');
  });

  it('sets plot curve width via set_stroke after plot()', () => {
    const defaults = defaultSceneDefaults();
    const ax = createAxes(defaults, 0);
    const plot = createGraphPlot(ax.id, 0);
    plot.fn.pyExpr = 'x';
    plot.strokeWidth = 6;

    const code = exportManimCode([ax, plot], {
      fullFile: true,
      defaults,
      audioItems: [],
    });

    expect(code).toContain('.set_stroke(width=6)');
  });

  it('merges two overlapping lines into one AnimationGroup with staggered Succession', () => {
    const defaults = defaultSceneDefaults();
    const a = createTextLine(defaults, 50);
    a.duration = 3;
    a.raw = 'A';
    a.segments = [seg('A')];
    const b = createTextLine(defaults, 51);
    b.duration = 2;
    b.raw = 'B';
    b.segments = [seg('B')];

    const code = exportManimCode([a, b], {
      fullFile: false,
      defaults,
      audioItems: [],
    });

    expect(code).toContain('AnimationGroup(');
    expect(code).toContain('Succession(Wait(0.0000), Write(');
    expect(code).toContain('Succession(Wait(1.0000), Write(');
    expect(code).toMatch(/run_time=3\.0000\)/);
  });

  it('merges two lines with the same start into one AnimationGroup', () => {
    const defaults = defaultSceneDefaults();
    const a = createTextLine(defaults, 10);
    a.duration = 3;
    a.raw = 'A';
    a.segments = [seg('A')];
    const b = createTextLine(defaults, 10);
    b.duration = 3;
    b.raw = 'B';
    b.segments = [seg('B')];

    const code = exportManimCode([a, b], {
      fullFile: false,
      defaults,
      audioItems: [],
    });

    expect(code).toContain('AnimationGroup(');
    expect(code).toMatch(/run_time=3\.0000\)/);
  });

  it('merges overlapping text line and surrounding rect into one AnimationGroup', () => {
    const defaults = defaultSceneDefaults();
    const line = createTextLine(defaults, 54);
    line.duration = 3;
    line.raw = 'ODE';
    line.segments = [seg('ODE')];
    const sr = createSurroundingRect([line.id], 56);

    const code = exportManimCode([line, sr], {
      fullFile: false,
      defaults,
      audioItems: [],
    });

    expect(code).toContain('AnimationGroup(');
    expect(code).toContain('Succession(Wait(0.0000), Write(');
    expect(code).toContain('Succession(Wait(2.0000), Create(');
    expect(code).not.toMatch(
      /Write\([^)]+\), run_time=[\d.]+\)\s*\n\s*self\.play\(Create\(sr_/,
    );
  });

  it('surrounding rect on text line segments uses VGroup of submobjects', () => {
    const defaults = defaultSceneDefaults();
    const line = createTextLine(defaults, 0);
    line.duration = 2;
    line.raw = 'a||b';
    line.segments = [
      { text: 'a', isMath: false, color: '#fff', bold: false, italic: false },
      { text: 'b', isMath: false, color: '#fff', bold: false, italic: false },
    ];
    const sr = createSurroundingRect([line.id], 0);
    sr.segmentIndices = [0, 1];

    const code = exportManimCode([line, sr], {
      fullFile: false,
      defaults,
      audioItems: [],
    });

    expect(code).toContain('VGroup(');
    expect(code).toMatch(/line_1\[0\]/);
    expect(code).toMatch(/line_1\[1\]/);
    expect(code).toContain('SurroundingRectangle(');
  });

  it('surrounding rect around two shapes uses VGroup of both vars', () => {
    const defaults = defaultSceneDefaults();
    const a = createShape(0);
    a.layer = 0;
    const b = createShape(0);
    b.layer = 1;
    const sr = createSurroundingRect([a.id, b.id], 0);

    const code = exportManimCode([a, b, sr], {
      fullFile: false,
      defaults,
      audioItems: [],
    });

    expect(code).toContain('VGroup(');
    expect(code).toContain('SurroundingRectangle(');
    const m = code.match(/VGroup\(([^)]+)\)/);
    expect(m).toBeTruthy();
    const inner = m![1]!.split(',').map((s) => s.trim()).filter(Boolean);
    expect(inner.length).toBe(2);
    expect(inner.every((x) => x.startsWith('shape_'))).toBe(true);
  });

  it('merges overlapping multi-segment line with another line (no per-segment waits)', () => {
    const defaults = defaultSceneDefaults();
    const a = createTextLine(defaults, 50);
    a.duration = 3;
    a.raw = 'A||B';
    a.segments = [
      { text: 'A', isMath: false, color: '#fff', bold: false, italic: false },
      { text: 'B', isMath: false, color: '#fff', bold: false, italic: false },
    ];
    const b = createTextLine(defaults, 51);
    b.duration = 2;
    b.raw = 'C';
    b.segments = [seg('C')];

    const code = exportManimCode([a, b], {
      fullFile: false,
      defaults,
      audioItems: [],
    });

    expect(code).toContain('AnimationGroup(');
    expect(code).toContain('Succession(Wait(0.0000), Write(');
  });

  it('does not merge back-to-back lines (holdEnd === next start)', () => {
    const defaults = defaultSceneDefaults();
    const a = createTextLine(defaults, 0);
    a.duration = 2;
    a.raw = 'A';
    a.segments = [seg('A')];
    const b = createTextLine(defaults, 2);
    b.duration = 2;
    b.raw = 'B';
    b.segments = [seg('B')];

    const code = exportManimCode([a, b], {
      fullFile: false,
      defaults,
      audioItems: [],
    });

    expect(code).not.toContain('AnimationGroup(');
    const writeCount = (code.match(/self\.play\(Write\(/g) ?? []).length;
    expect(writeCount).toBe(2);
  });

  it('caps bound-audio tail after first line so the next line is not delayed by full file length', () => {
    const defaults = defaultSceneDefaults();
    const a = createTextLine(defaults, 0);
    a.duration = 3;
    a.raw = 'WorstCase';
    a.segments = [seg('WorstCase')];
    a.audioTrackId = 'shared';

    const b = createTextLine(defaults, 5.5);
    b.duration = 2;
    b.raw = 'NoSol';
    b.segments = [seg('NoSol')];
    b.audioTrackId = 'shared';

    const code = exportManimCode([a, b], {
      fullFile: false,
      defaults,
      audioItems: [
        {
          id: 'shared',
          text: 'x',
          audioUrl: '/assets/audio/x.webm',
          assetRelPath: 'assets/audio/x.webm',
          startTime: 0,
          duration: 20,
          boundaries: [
            { word: 'w', start: 0, end: 3 },
            { word: 'n', start: 5.5, end: 7.5 },
          ],
        },
      ],
    });

    expect(code).toMatch(/self\.wait\(2\.5000\)/);
    const writeBlocks = code.match(/Write\(/g) ?? [];
    expect(writeBlocks.length).toBeGreaterThanOrEqual(2);
  });

  it('emits add_sound at track start when bound audio begins before the line (no duplicate at line play)', () => {
    const defaults = defaultSceneDefaults();
    const line = createTextLine(defaults, 8);
    line.duration = 2;
    line.raw = 'ODE';
    line.segments = [seg('ODE')];
    line.audioTrackId = 'early_a';

    const code = exportManimCode([line], {
      fullFile: false,
      defaults,
      audioItems: [
        {
          id: 'early_a',
          text: 'narration',
          audioUrl: '/assets/audio/x.webm',
          assetRelPath: 'assets/audio/x.webm',
          startTime: 4.8,
          duration: 10,
          boundaries: [{ word: 'x', start: 0, end: 2 }],
        },
      ],
    });

    const sounds = code.match(/self\.add_sound/g) ?? [];
    expect(sounds.length).toBe(1);
    expect(code.indexOf('self.add_sound')).toBeLessThan(code.indexOf('Write('));
  });

  it('emits self.wait tail when bound audio file is longer than boundary run_time', () => {
    const defaults = defaultSceneDefaults();
    const line = createTextLine(defaults, 0);
    line.duration = 1.5;
    line.raw = 'Hi';
    line.segments = [
      {
        text: 'Hi',
        isMath: false,
        color: '#fff',
        bold: false,
        italic: false,
      },
    ];
    line.audioTrackId = 'a1';

    const code = exportManimCode([line], {
      fullFile: false,
      defaults,
      audioItems: [
        {
          id: 'a1',
          text: 'Hi',
          audioUrl: '/assets/audio/x.webm',
          assetRelPath: 'assets/audio/x.webm',
          startTime: 0,
          duration: 5,
          boundaries: [{ word: 'Hi', start: 0, end: 1.5 }],
        },
      ],
    });

    expect(code).toContain('self.add_sound(');
    expect(code).toMatch(/self\.wait\(3\.5000\)/);
  });

  it('exports per-segment Succession with Wait when segment has waitAfterSec', () => {
    const defaults = defaultSceneDefaults();
    const line = createTextLine(defaults, 0);
    line.duration = 2;
    line.raw = 'A||B';
    line.segments = [
      {
        text: 'A',
        isMath: false,
        color: '#fff',
        bold: false,
        italic: false,
        waitAfterSec: 0.5,
      },
      {
        text: 'B',
        isMath: false,
        color: '#fff',
        bold: false,
        italic: false,
      },
    ];

    const code = exportManimCode([line], {
      fullFile: false,
      defaults,
      audioItems: [],
    });

    expect(code).toContain('Succession(');
    expect(code).toContain('Wait(0.5000)');
    expect(code).toContain('[0]');
    expect(code).toContain('[1]');
  });

  it('segment waitAfterSec does not inflate run_time when bound audio is present', () => {
    // The segment wait must appear as Wait() inside Succession, NOT be included in
    // run_time — which would double-count it and cause the Write to run past the audio end.
    const defaults = defaultSceneDefaults();
    const line = createTextLine(defaults, 0);
    line.duration = 3;
    line.raw = 'A||B';
    line.segments = [
      {
        text: 'A',
        isMath: false,
        color: '#fff',
        bold: false,
        italic: false,
        waitAfterSec: 2,
      },
      {
        text: 'B',
        isMath: false,
        color: '#fff',
        bold: false,
        italic: false,
      },
    ];
    line.audioTrackId = 'narr';

    // Audio: 4-second file covering the 3-second animation (not the 5-second effective duration).
    const code = exportManimCode([line], {
      fullFile: false,
      defaults,
      audioItems: [
        {
          id: 'narr',
          text: 'narration',
          audioUrl: '/assets/audio/narr.webm',
          assetRelPath: 'assets/audio/narr.webm',
          startTime: 0,
          duration: 4,
          boundaries: [
            { word: 'A', start: 0, end: 1.5 },
            { word: 'B', start: 1.5, end: 3 },
          ],
        },
      ],
    });

    // run_time for each segment must be based on the 3-second narration boundary span,
    // NOT the 5-second effective duration (3 + 2 wait).  So per-segment ≈ 1.5s.
    expect(code).toMatch(/Write\([^)]+\[0\][^)]+run_time=1\.5/);
    // The Wait(2) must still appear as a separate node.
    expect(code).toContain('Wait(2.0000)');
    // The total self.play Succession runs for 3s (narration) + 2s (wait) = 5s,
    // so a 1-second tail wait follows to let the 4s file finish from scene-time 0.
    // audioEnd = 0 + 4 = 4; animEnd = 0 + 3 + 2 = 5 → tail = max(0, 4 - 5) = 0.
    // Actually 4 < 5 so tail = 0 — the audio ends before the animation; no tail wait needed.
    expect(code).not.toMatch(/self\.wait\(\d/);
  });

  it('uses per-segment animSec for unequal Write run_time in Succession', () => {
    const defaults = defaultSceneDefaults();
    const line = createTextLine(defaults, 0);
    line.duration = 3;
    line.raw = 'A||B';
    line.segments = [
      {
        text: 'A',
        isMath: false,
        color: '#fff',
        bold: false,
        italic: false,
        animSec: 2,
      },
      {
        text: 'B',
        isMath: false,
        color: '#fff',
        bold: false,
        italic: false,
        animSec: 1,
      },
    ];

    const code = exportManimCode([line], {
      fullFile: false,
      defaults,
      audioItems: [],
    });

    expect(code).toMatch(/Write\([^)]+\[0\][^)]+run_time=2\.0/);
    expect(code).toMatch(/Write\([^)]+\[1\][^)]+run_time=1\.0/);
  });
});
