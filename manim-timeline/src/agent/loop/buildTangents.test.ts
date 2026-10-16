import { describe, expect, it } from 'vitest';
import { createAxes, defaultSceneDefaults } from '@/store/factories';
import type { FrameDef, ItemId, SceneItem, ShapeItem } from '@/types/scene';
import { AGENT_CHAT_RESPONSE_JSON_SCHEMA } from '../types';
import { GEMINI_RESPONSE_SCHEMA } from '../providers/gemini';
import { buildSystemPrompt } from '../systemPrompt';
import { DraftSession } from './draft';
import { runLoopTool } from './tools';

const frames: FrameDef[] = [{ id: 'home', col: 0, row: 0 }];

function session() {
  const ax = createAxes(defaultSceneDefaults());
  ax.id = 'ax';
  ax.xRange = [-2, 2, 1];
  ax.yRange = [-1, 4, 1];
  return new DraftSession({
    items: new Map<ItemId, SceneItem>([[ax.id, ax]]),
    frames,
    startFrameId: 'home',
    activeFrameId: 'home',
    defaults: defaultSceneDefaults(),
    audioItems: [],
    currentTimeSec: 0,
  });
}

const plot = { action: 'CREATE', item: { id: 'p1', kind: 'graphPlot', axesId: 'ax', label: 'f', startTime: 0, duration: 1, fn: { jsExpr: 'x*x', pyExpr: 'x**2' }, xDomain: [-2, 2] } };
const dot = (id: string, x: number) => ({
  action: 'CREATE',
  item: { id, kind: 'graphDot', axesId: 'ax', label: id, startTime: 1, duration: 0.5, dot: { attachment: { kind: 'function', graphPlotId: 'p1', x } } },
});
const move = { action: 'CREATE', item: { id: 'm1', kind: 'target_animation', label: 'move', mode: 'graphFollow', startTime: 2, duration: 2, targets: [{ targetId: 'd1', targetX: 1.5, easing: 'linear' }] } };
const line = (endpoints: Record<string, unknown>, id = 'l1') => ({
  action: 'CREATE',
  item: { id, kind: 'shape', shapeType: 'line', label: 'line', startTime: 1, duration: 0.5, strokeColor: '#fbbf24', endpoints },
});

async function inspect(s: DraftSession, input: Record<string, unknown>) {
  const out = await runLoopTool({ id: 'x', name: 'inspect_scene', input }, s, {});
  return JSON.parse(out.result.text);
}

describe('tangent and secant connectors (R17, R18)', () => {
  it('creates a tangent from the dot alone and reports its slope as the dot moves', async () => {
    const s = session();
    expect(s.propose([plot, dot('d1', -1), move, line({ start: { kind: 'graphDot', dotId: 'd1' }, tangent: { length: 2 } })])).toMatchObject({ ok: true });
    const l1 = s.scene().get('l1') as ShapeItem;
    expect(l1.endpoints).toEqual({ start: { kind: 'graphDot', dotId: 'd1' }, end: { kind: 'graphDot', dotId: 'd1' }, tangent: { length: 2 } });
    const facts = await inspect(s, { itemIds: ['l1'], times: [1.5, 3, 4] });
    const slopes = facts.items[0].at.map((row: { slope: number }) => row.slope);
    // x goes -1 → 0.25 → 1.5, so f'(x) = 2x.
    expect(slopes[0]).toBeCloseTo(-2, 2);
    expect(slopes[1]).toBeCloseTo(0.5, 2);
    expect(slopes[2]).toBeCloseTo(3, 2);
    expect(facts.items[0].at[1].length).toBeCloseTo(2, 2);
    const exp = await runLoopTool({ id: 'y', name: 'check_export', input: {} }, s, {});
    expect(JSON.parse(exp.result.text)).toMatchObject({ ok: true });
  });

  it('keeps extend on a line through two dots and rejects bad tangents', () => {
    const s = session();
    expect(s.propose([plot, dot('d1', -1), dot('d2', 1), line({ start: { kind: 'graphDot', dotId: 'd1' }, end: { kind: 'graphDot', dotId: 'd2' }, extend: 1.5 })])).toMatchObject({ ok: true });
    expect((s.scene().get('l1') as ShapeItem).endpoints?.extend).toBe(1.5);
    s.reset();
    const bad = s.propose([plot, dot('d1', -1), line({ start: { kind: 'point', x: 0, y: 0 }, tangent: { length: 2 } })]);
    expect(bad.ok).toBe(false);
    expect(bad.ok ? '' : bad.errors.join('\n')).toMatch(/start must be a "graphDot" anchor for a tangent/);
    const negative = s.propose([plot, dot('d1', -1), line({ start: { kind: 'graphDot', dotId: 'd1' }, tangent: { length: -1 } })]);
    expect(negative.ok ? '' : negative.errors.join('\n')).toMatch(/tangent must be \{ length: <positive number>/);
  });

  it('declares extend and tangent in both schemas and teaches the recipes', () => {
    const anyOf = AGENT_CHAT_RESPONSE_JSON_SCHEMA.properties.actions.items.anyOf as unknown as { properties: Record<string, { properties?: Record<string, unknown> }> }[];
    const gemini = GEMINI_RESPONSE_SCHEMA.properties.actions.items.properties;
    for (const schema of [anyOf[0]!.properties.item!.properties!, anyOf[1]!.properties.updates!.properties!, gemini.item.properties as Record<string, unknown>, gemini.updates.properties as Record<string, unknown>]) {
      expect(schema).toHaveProperty('endpoints.properties.extend.type', 'number');
      expect(schema).toHaveProperty('endpoints.properties.tangent.properties.length.type', 'number');
    }
    for (const prompt of [buildSystemPrompt(''), buildSystemPrompt('', 'loop')]) {
      expect(prompt).toContain('R17. A tangent that rides along');
      expect(prompt).toContain('R18. Secant turning into the tangent');
      expect(prompt).toContain('Never fake a moving tangent with many short static lines');
    }
  });
});
