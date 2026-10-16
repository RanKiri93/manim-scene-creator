import { describe, expect, it } from 'vitest';
import { createAxes, defaultSceneDefaults } from '@/store/factories';
import type { FrameDef, ItemId, MeasureResult, SceneItem, TextLineItem } from '@/types/scene';
import { validateAgentResponse } from '../validate';
import { buildSystemPrompt } from '../systemPrompt';
import { DraftSession } from './draft';
import { runLoopTool } from './tools';

const frames: FrameDef[] = [{ id: 'home', col: 0, row: 0 }];

function session(items: SceneItem[] = []) {
  const axes = createAxes(defaultSceneDefaults());
  axes.id = 'ax1';
  axes.xRange = [-3, 3, 1];
  axes.yRange = [-2, 2, 1];
  return new DraftSession({
    items: new Map<ItemId, SceneItem>([axes, ...items].map((it) => [it.id, it])),
    frames,
    startFrameId: 'home',
    activeFrameId: 'home',
    defaults: defaultSceneDefaults(),
    audioItems: [],
    currentTimeSec: 0,
  });
}

function measured(width: number): MeasureResult {
  return {
    width, height: 0.6, widthInk: width, heightInk: 0.6, offsetInkX: 0, offsetInkY: 0,
    inkLeftX: 0, inkRightX: 0, inkTopY: 0, inkBottomY: 0, bboxLeft: 0, bboxRight: 0, bboxTop: 0, bboxBottom: 0,
    pngBase64: null, pngWidth: null, pngHeight: null, segmentMeasures: null, mathChildMeasures: null,
  };
}

const line = (id: string, raw: string, extra: Record<string, unknown> = {}) => ({
  action: 'CREATE',
  item: { id, kind: 'textLine', label: id, raw, font: 'Alef', startTime: 0, duration: 1, posSteps: [{ kind: 'to_edge', edge: 'UP', buff: 0.5 }], ...extra },
});

async function inspect(s: DraftSession, input: Record<string, unknown>, env = {}) {
  const out = await runLoopTool({ id: 'i', name: 'inspect_scene', input }, s, env);
  expect(out.result.isError).toBeFalsy();
  return JSON.parse(out.result.text);
}

describe('Point at one term (R10)', () => {
  const formula = line('f1', '$(x+1)^2 = x^2 +{}$$2x$${}+ 1$', { baseDir: 'ltr' });
  const colour = { action: 'UPDATE', itemId: 'f1', updates: { raw: '$(x+1)^2 = x^2 +{}$$2x$${}+ 1$', segments: [{}, { color: '#ffff00' }] } };

  it('lets the tool loop create a line and style it in one draft, as Approve will', async () => {
    const s = session();
    expect(s.propose([formula, colour])).toMatchObject({ ok: true });
    const f1 = s.scene().get('f1') as TextLineItem;
    expect(f1.segments.map((seg) => seg.text)).toEqual(['(x+1)^2 = x^2 +{}', '2x', '{}+ 1']);
    expect(f1.segments[1]!.color).toBe('#ffff00');
    const facts = await inspect(s, { itemIds: ['f1'], times: [0.5] });
    expect(facts.items[0].segments[1]).toMatchObject({ i: 1, text: '2x', math: true, color: '#ffff00' });
  });

  it('keeps the two-step rule for single replies', () => {
    const r = validateAgentResponse({ reply: 'x', actions: [formula, colour] }, new Map(), {
      frameIds: ['home'], frames, activeFrameId: 'home', startFrameId: 'home',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/Split into two approvals/);
  });

  it('rejects a segment index the line does not have, listing the segments', () => {
    const s = session();
    const blink = { action: 'CREATE', item: { id: 'b1', kind: 'blink_animation', label: 'pulse', startTime: 1, duration: 0.6, targets: [{ targetId: 'f1', mode: 'scale', segmentIndices: [3] }] } };
    const r = s.propose([formula, blink]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/segment 3 does not exist on text line "f1" \(segments 0: .*1: "2x", 2: /);
    expect(s.propose([formula, { ...blink, item: { ...blink.item, targets: [{ targetId: 'f1', mode: 'scale', segmentIndices: [1] }] } }])).toMatchObject({ ok: true });
  });
});

describe('Lesson slide (R9)', () => {
  it('measures new text before inspecting and reports overlaps and lines leaving the camera', async () => {
    const s = session();
    expect(
      s.propose([
        line('t1', 'כותרת'),
        line('t2', 'שורה ראשונה'),
        line('t3', 'שורה שנייה ארוכה', { posSteps: [{ kind: 'next_to', refKind: 'line', refId: 't1', dir: 'DOWN', buff: 0.3, alignedEdge: 'RIGHT' }, { kind: 'shift', dx: 6, dy: 0 }] }),
      ]),
    ).toMatchObject({ ok: true });

    const before = await inspect(s, { times: [2] });
    expect(before.items[0].note).toMatch(/not measured/);
    expect(before.textOverlaps).toEqual([]);

    const asked: string[] = [];
    const measureText = async (item: TextLineItem) => {
      asked.push(item.raw);
      return measured(item.id === 't3' ? 5 : 3);
    };
    const facts = await inspect(s, { times: [2] }, { measureText });
    expect(asked.sort()).toEqual(['כותרת', 'שורה ראשונה', 'שורה שנייה ארוכה'].sort());
    expect(facts.textOverlaps).toEqual([{ t: 2, ids: ['t1', 't2'], overlap: [3, 0.6] }]);
    const t3 = facts.items.find((it: { id: string }) => it.id === 't3');
    expect(t3.at[0]).toMatchObject({ inCamera: false, outside: ['right'] });
    expect(facts.items[0].at[0]).toMatchObject({ inCamera: true });

    // Cached: a second inspect does not measure again.
    await inspect(s, { times: [2] }, { measureText });
    expect(asked).toHaveLength(3);
  });
});

describe('Convergence story (R8)', () => {
  const taylorTerm = '(-1)**n * x**(2*n+1) / Array.from({length: 2*n+1}, (_, i) => i + 1).reduce((p, k) => p * k, 1)';

  it("the recipe's JS factorial gives the Taylor polynomials of sin", () => {
    const term = new Function('n', 'x', `"use strict"; return (${taylorTerm});`) as (n: number, x: number) => number;
    let sum = 0;
    for (let n = 0; n <= 4; n++) sum += term(n, 1.2);
    expect(sum).toBeCloseTo(Math.sin(1.2), 6);
  });

  it('inspect lists when each curve draws and which one shows', async () => {
    const s = session();
    const series = {
      action: 'CREATE',
      item: {
        id: 'fs1', kind: 'graphFunctionSeries', axesId: 'ax1', label: 'Taylor', startTime: 0,
        jsExpr: taylorTerm, pyExpr: '(-1)**n * x**(2*n+1) / np.prod(np.arange(1.0, 2*n + 2))',
        nMin: 0, nMax: 4, displayMode: 'partialSum', mode: 'replacement', defaults: { animDuration: 1, waitAfter: 0.5 },
      },
    };
    expect(s.propose([series])).toMatchObject({ ok: true });
    const facts = await inspect(s, { itemIds: ['fs1'], times: [0.5, 6.5, 9] });
    const fs = facts.items[0];
    expect(fs.curves).toEqual([
      { n: 0, from: 0, to: 1 },
      { n: 1, from: 1.5, to: 2.5 },
      { n: 2, from: 3, to: 4 },
      { n: 3, from: 4.5, to: 5.5 },
      { n: 4, from: 6, to: 7 },
    ]);
    expect(fs.at.map((row: { showing: unknown }) => row.showing)).toEqual([['0 (drawing)'], ['3→4 (morphing)'], [4]]);
  });
});

describe('Camera story beats (R11)', () => {
  it('reports where each camera clip ends and the camera at the beat and after the return', async () => {
    const s = session();
    const zoom = { action: 'CREATE', item: { id: 'c1', kind: 'camera_move', label: 'zoom', startTime: 2, duration: 1, targetMode: 'region', region: { left: 1, right: 5, bottom: -1, top: 1.25 } } };
    const back = { action: 'CREATE', item: { id: 'c2', kind: 'camera_move', label: 'back', startTime: 6, duration: 1, targetMode: 'frame', targetFrameId: 'home' } };
    expect(s.propose([zoom, back])).toMatchObject({ ok: true });
    const facts = await inspect(s, { itemIds: ['c1', 'c2'], times: [4, 8] });
    const [c1, c2] = facts.items;
    expect(c1.endsAt.center[0]).toBeCloseTo(3);
    expect(c1.endsAt.width).toBeLessThan(6);
    expect(c2.endsAt).toEqual({ center: [0, 0], width: facts.camera[1].width });
    expect(facts.camera[0].width).toBeCloseTo(c1.endsAt.width);
    expect(facts.camera[1].width).toBeCloseTo(14.222, 2);
  });
});

describe('prompt', () => {
  it('teaches the four recipes in both modes and swaps the two-step rule in the loop', () => {
    const single = buildSystemPrompt('');
    const loop = buildSystemPrompt('', 'loop');
    for (const prompt of [single, loop]) {
      for (const heading of ['R8. Convergence story', 'R9. Lesson slide', 'R10. Point at one term', 'R11. Camera story beats']) {
        expect(prompt).toContain(heading);
      }
      expect(prompt).toContain('"הפיתוח \\en{$x^2 +{}$$2x$${}+ 1$}"');
    }
    expect(single).toContain('Two-step rule for CREATE');
    expect(loop).not.toContain('Two-step rule for CREATE');
    expect(loop).toContain('in the same draft; inspect_scene lists its segments');
    expect(loop).toContain('R11: inspect at the beat time');
  });
});
