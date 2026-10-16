import { describe, expect, it } from 'vitest';
import { createAxes, defaultSceneDefaults } from '@/store/factories';
import type { FrameDef, GraphAreaItem, ItemId, SceneItem } from '@/types/scene';
import { AGENT_CHAT_RESPONSE_JSON_SCHEMA } from '../types';
import { GEMINI_RESPONSE_SCHEMA } from '../providers/gemini';
import { buildSystemPrompt } from '../systemPrompt';
import { DraftSession } from './draft';
import { runLoopTool } from './tools';

const frames: FrameDef[] = [{ id: 'home', col: 0, row: 0 }];

function session() {
  const ax = createAxes(defaultSceneDefaults());
  ax.id = 'ax';
  ax.xRange = [0, 3, 1];
  ax.yRange = [0, 9, 1];
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

const plot = { action: 'CREATE', item: { id: 'p1', kind: 'graphPlot', axesId: 'ax', label: 'f', startTime: 0, duration: 1, fn: { jsExpr: 'x*x', pyExpr: 'x**2' }, xDomain: [0, 3] } };
const riemann = (area: Record<string, unknown>) => ({
  action: 'CREATE',
  item: { id: 'r1', kind: 'graphArea', axesId: 'ax', label: 'sums', startTime: 1, duration: 4, strokeWidth: 1, area: { areaKind: 'riemann', xMin: 0, xMax: 3, curve: { plotId: 'p1' }, ...area } },
});

describe('Riemann sums (R21)', () => {
  it('stores rule and counts, reports each sum and the integral, and which n shows when', async () => {
    const s = session();
    expect(s.propose([plot, riemann({ rule: 'center', counts: [3, 6, 30, 60] })])).toMatchObject({ ok: true });
    const r1 = s.scene().get('r1') as GraphAreaItem;
    expect(r1.mode).toEqual({ areaKind: 'riemann', xMin: 0, xMax: 3, curve: { sourceKind: 'plot', plotId: 'p1' }, rule: 'middle', counts: [3, 6, 30, 60] });
    const out = await runLoopTool({ id: 'x', name: 'inspect_scene', input: { itemIds: ['r1'], times: [1.5, 2.6, 6] } }, s, {});
    const facts = JSON.parse(out.result.text).items[0];
    expect(facts.area).toMatchObject({ areaKind: 'riemann', rule: 'middle', integral: 9 });
    expect(facts.area.sums.map((x: { sum: number }) => x.sum)).toEqual([8.75, 8.938, 8.998, 8.999]);
    expect(facts.at.map((row: { riemannN: number }) => row.riemannN)).toEqual([3, 6, 60]);
    const exp = await runLoopTool({ id: 'y', name: 'check_export', input: {} }, s, {});
    expect(JSON.parse(exp.result.text)).toMatchObject({ ok: true });
  });

  it('checks counts, the rule and the plot domain', () => {
    const s = session();
    const errs = (area: Record<string, unknown>) => {
      const r = s.propose([plot, riemann(area)]);
      s.reset();
      return r.ok ? '' : r.errors.join('\n');
    };
    expect(errs({ counts: [] })).toMatch(/counts must be whole numbers of rectangles from 1 to 200/);
    expect(errs({ counts: [4, 500] })).toMatch(/counts must be whole numbers/);
    expect(errs({ counts: [4], rule: 'trapezoid' })).toMatch(/rule must be "left", "middle" or "right"/);
    expect(errs({ counts: [4], xMax: 4 })).toMatch(/leaves plot "p1"'s domain/);
  });

  it('is in both schemas and the prompt', () => {
    const anyOf = AGENT_CHAT_RESPONSE_JSON_SCHEMA.properties.actions.items.anyOf as unknown as { properties: Record<string, { properties?: Record<string, unknown> }> }[];
    const gemini = GEMINI_RESPONSE_SCHEMA.properties.actions.items.properties;
    for (const schema of [anyOf[0]!.properties.item!.properties!, anyOf[1]!.properties.updates!.properties!, gemini.item.properties as Record<string, unknown>, gemini.updates.properties as Record<string, unknown>]) {
      expect(schema).toHaveProperty('area.properties.areaKind.enum', expect.arrayContaining(['riemann']));
      expect(schema).toHaveProperty('area.properties.counts.type', 'array');
    }
    const prompt = buildSystemPrompt('', 'loop');
    expect(prompt).toContain('"areaKind": "riemann"');
    expect(prompt).toContain('R21. Riemann sums');
  });
});
