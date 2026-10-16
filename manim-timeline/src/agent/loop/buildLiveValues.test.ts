import { describe, expect, it } from 'vitest';
import { createAxes, defaultSceneDefaults } from '@/store/factories';
import type { FrameDef, GraphDotItem, ItemId, SceneItem } from '@/types/scene';
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
const dot = (extra: Record<string, unknown>, attachment: Record<string, unknown> = { kind: 'function', graphPlotId: 'p1', x: -1 }) => ({
  action: 'CREATE',
  item: { id: 'd1', kind: 'graphDot', axesId: 'ax', label: 'P', startTime: 1, duration: 0.5, dot: { attachment, showCoordinates: true, coordinatePrecision: 2, ...extra } },
});
const move = { action: 'CREATE', item: { id: 'm1', kind: 'target_animation', label: 'move', mode: 'graphFollow', startTime: 2, duration: 2, targets: [{ targetId: 'd1', targetX: 1.5, easing: 'linear' }] } };

describe('live values (R3)', () => {
  it('keeps a template and inspect shows the label text as the dot moves', async () => {
    const s = session();
    expect(s.propose([plot, dot({ valueTemplate: " f'(x) = {slope} " }), move])).toMatchObject({ ok: true });
    expect((s.scene().get('d1') as GraphDotItem).dot.valueTemplate).toBe("f'(x) = {slope}");
    const out = await runLoopTool({ id: 'x', name: 'inspect_scene', input: { itemIds: ['d1'], times: [1.5, 4] } }, s, {});
    const rows = JSON.parse(out.result.text).items[0].at;
    expect(rows.map((r: { liveLabel: string }) => r.liveLabel)).toEqual(["f'(x) = -2.00", "f'(x) = 3.00"]);
    const exp = await runLoopTool({ id: 'y', name: 'check_export', input: {} }, s, {});
    expect(JSON.parse(exp.result.text)).toMatchObject({ ok: true });
  });

  it('rejects unknown names and a slope with no plot', () => {
    const s = session();
    const unknown = s.propose([plot, dot({ valueTemplate: 'A = {area}' })]);
    expect(unknown.ok ? '' : unknown.errors.join('\n')).toMatch(/valueTemplate uses \{area\}; only \{x\}, \{y\} and \{slope\}/);
    const free = s.propose([plot, dot({ valueTemplate: '{slope}' }, { kind: 'free' })]);
    expect(free.ok ? '' : free.errors.join('\n')).toMatch(/dot "d1" shows \{slope\} but Graph dot "d1" is not on a function plot/);
  });

  it('is in both schemas and the recipe', () => {
    const anyOf = AGENT_CHAT_RESPONSE_JSON_SCHEMA.properties.actions.items.anyOf as unknown as { properties: Record<string, { properties?: Record<string, unknown> }> }[];
    const gemini = GEMINI_RESPONSE_SCHEMA.properties.actions.items.properties;
    for (const schema of [anyOf[0]!.properties.item!.properties!, anyOf[1]!.properties.updates!.properties!, gemini.item.properties as Record<string, unknown>, gemini.updates.properties as Record<string, unknown>]) {
      expect(schema).toHaveProperty('dot.properties.valueTemplate.type', 'string');
    }
    expect(buildSystemPrompt('', 'loop')).toContain('dot.valueTemplate: "f(x) = {y}"');
  });
});
