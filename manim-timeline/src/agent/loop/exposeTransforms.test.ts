import { describe, expect, it } from 'vitest';
import { defaultSceneDefaults } from '@/store/factories';
import type { FrameDef, ItemId, MeasureResult, SceneItem, TextLineItem } from '@/types/scene';
import { AGENT_CHAT_RESPONSE_JSON_SCHEMA } from '../types';
import { GEMINI_RESPONSE_SCHEMA } from '../providers/gemini';
import { buildSystemPrompt } from '../systemPrompt';
import { DraftSession } from './draft';
import { runLoopTool } from './tools';

const frames: FrameDef[] = [{ id: 'home', col: 0, row: 0 }];

function session(items: SceneItem[] = []) {
  return new DraftSession({
    items: new Map<ItemId, SceneItem>(items.map((it) => [it.id, it])),
    frames,
    startFrameId: 'home',
    activeFrameId: 'home',
    defaults: defaultSceneDefaults(),
    audioItems: [],
    currentTimeSec: 0,
  });
}

const STEP1 = '$2x$${}+3$${}={}$$7$';
const STEP2 = '$2x$${}={}$$7$${}-3$';
const at = [{ kind: 'to_edge', edge: 'UP', buff: 1 }];
const step = (id: string, raw: string, extra: Record<string, unknown> = {}) => ({
  action: 'CREATE',
  item: { id, kind: 'textLine', label: id, raw, baseDir: 'ltr', font: 'Alef', startTime: 0, duration: 1, posSteps: at, ...extra },
});
const morph = (pairs: unknown, extra: Record<string, unknown> = {}) =>
  step('s2', STEP2, {
    startTime: 2,
    duration: 1.5,
    transformConfig: { sourceLineId: 's1', mode: 'segments', pairs, unmappedSourceBehavior: 'fade_out', unmappedTargetBehavior: 'fade_in' },
    ...extra,
  });
const goodPairs = [
  { from: 0, to: 0 },
  { from: 2, to: 1 },
  { from: 3, to: 2 },
  { from: 1, to: 3 },
];

function measured(): MeasureResult {
  return {
    width: 2, height: 0.5, widthInk: 2, heightInk: 0.5, offsetInkX: 0, offsetInkY: 0, inkLeftX: 0, inkRightX: 0, inkTopY: 0,
    inkBottomY: 0, bboxLeft: 0, bboxRight: 0, bboxTop: 0, bboxBottom: 0, pngBase64: null, pngWidth: null, pngHeight: null,
    segmentMeasures: null, mathChildMeasures: null,
  };
}

function errorsOf(s: DraftSession, actions: unknown[]): string {
  const r = s.propose(actions);
  expect(r.ok).toBe(false);
  return r.ok ? '' : r.errors.join('\n');
}

describe('Equation steps that morph (R14)', () => {
  it('accepts a step that morphs the previous one, implying animStyle "transform"', async () => {
    const s = session();
    expect(s.propose([step('s1', STEP1), morph(goodPairs)])).toMatchObject({ ok: true });
    const s2 = s.scene().get('s2') as TextLineItem;
    expect(s2.animStyle).toBe('transform');
    expect(s2.transformConfig).toMatchObject({ sourceLineId: 's1', mode: 'segments', segmentPairs: { 0: 0, 1: 2, 2: 3, 3: 1 } });

    const out = await runLoopTool({ id: 'i', name: 'inspect_scene', input: { itemIds: ['s1', 's2'], times: [1, 2.5, 4] } }, s, { measureText: async () => measured() });
    const facts = JSON.parse(out.result.text);
    const [s1Facts, s2Facts] = facts.items;
    expect(s2Facts.transform.pairs).toEqual([
      { from: 0, to: 0, text: '2x' },
      { from: 2, to: 1, text: '{}={}' },
      { from: 3, to: 2, text: '7' },
      { from: 1, to: 3, text: '{}+3 → {}-3' },
    ]);
    expect(s1Facts.turnsInto).toEqual(['s2']);
    expect(s1Facts.at.map((r: { onScreen: boolean }) => r.onScreen)).toEqual([true, true, false]);
    expect(s1Facts.at[2].note).toMatch(/morphed/);
    // Same place on purpose: a line and the step it morphs into are not an overlap.
    expect(facts.textOverlaps).toEqual([]);

    const exported = await runLoopTool({ id: 'e', name: 'check_export', input: {} }, s, {});
    expect(JSON.parse(exported.result.text)).toMatchObject({ ok: true });
  });

  it('rejects pairs that do not fit the lines, a source used twice, bad timing and a missing source', () => {
    const s = session();
    expect(errorsOf(s, [step('s1', STEP1), morph([{ from: 0, to: 0 }, { from: 0, to: 1 }])])).toMatch(/source segment 0 "2x" is paired with both 0 and 1/);
    expect(errorsOf(s, [step('s1', STEP1), morph([{ from: 7, to: 9 }])])).toMatch(/pair to 9 — this line has no segment 9[\s\S]*pair from 7 — source "s1" has no segment 7 \(segments 0: "2x", 1: "\{\}\+3"/);
    expect(errorsOf(s, [step('s1', STEP1), morph(goodPairs, { startTime: 0.5 })])).toMatch(/before its source "s1" has finished appearing \(1s\)/);
    const exit = { action: 'CREATE', item: { id: 'x1', kind: 'exit_animation', label: 'out', startTime: 1, duration: 0.5, targets: [{ targetId: 's1', animStyle: 'fade_out' }] } };
    expect(errorsOf(s, [step('s1', STEP1), exit, morph(goodPairs)])).toMatch(/source "s1" has already left the scene/);
    expect(errorsOf(s, [step('s1', STEP1, { animStyle: 'transform' })])).toMatch(/animStyle "transform" but no transformConfig/);
    expect(errorsOf(s, [step('s1', STEP1, { animStyle: 'morph' })])).toMatch(/animStyle must be "write", "fade_in" or "transform"/);
    expect(errorsOf(s, [step('s1', STEP1), step('s2', STEP2, { startTime: 2, transformConfig: { sourceLineId: 'nope', pairs: [] } })])).toMatch(/transform source "nope" is not a text line/);
  });

  it('warns about a segment transform without pairs and accepts an UPDATE that adds the morph', () => {
    const s = session();
    const r = s.propose([step('s1', STEP1), step('s2', STEP2, { startTime: 2, transformConfig: { sourceLineId: 's1' } })]);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.warnings.join(' ')).toMatch(/no pairs; every piece fades/);
    expect(s.propose([{ action: 'UPDATE', itemId: 's2', updates: { transformConfig: { sourceLineId: 's1', pairs: goodPairs } } }])).toMatchObject({ ok: true });
    expect((s.scene().get('s2') as TextLineItem).transformConfig?.segmentPairs).toEqual({ 0: 0, 1: 2, 2: 3, 3: 1 });
  });
});

describe('schemas and prompt', () => {
  it('declares animStyle and transformConfig in both schemas, for CREATE and UPDATE', () => {
    const anyOf = AGENT_CHAT_RESPONSE_JSON_SCHEMA.properties.actions.items.anyOf as unknown as { properties: Record<string, { properties?: Record<string, unknown> }> }[];
    const gemini = GEMINI_RESPONSE_SCHEMA.properties.actions.items.properties;
    for (const schema of [anyOf[0]!.properties.item!.properties!, anyOf[1]!.properties.updates!.properties!, gemini.item.properties as Record<string, unknown>, gemini.updates.properties as Record<string, unknown>]) {
      expect(schema).toHaveProperty('animStyle.enum');
      expect(schema).toHaveProperty('transformConfig.properties.pairs.items.properties.from');
    }
  });

  it('teaches equation steps in both modes', () => {
    for (const prompt of [buildSystemPrompt(''), buildSystemPrompt('', 'loop')]) {
      expect(prompt).toContain('5c. Text line entrance and equation steps');
      expect(prompt).toContain('R14. Equation steps that morph');
      expect(prompt).toContain('"$2x$${}+3$${}={}$$7$"');
    }
  });
});
