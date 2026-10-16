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
  ax.yRange = [-2, 2, 1];
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

const curve = { action: 'CREATE', item: { id: 'c1', kind: 'graphCurve', axesId: 'ax', label: 'Lissajous', startTime: 0, duration: 0.5, curve: { jsXExpr: 'Math.sin(3*t)', jsYExpr: 'Math.sin(2*t)', pyXExpr: 'np.sin(3*t)', pyYExpr: 'np.sin(2*t)' }, tDomain: [0, 6.3] } };
const dot = (trace: unknown) => ({
  action: 'CREATE',
  item: { id: 'd1', kind: 'graphDot', axesId: 'ax', label: 'P', startTime: 1, duration: 0.5, dot: { attachment: { kind: 'parametric', graphCurveId: 'c1', t: 0 }, trace } },
});
const move = { action: 'CREATE', item: { id: 'm1', kind: 'target_animation', label: 'go round', mode: 'graphFollow', startTime: 2, duration: 4, targets: [{ targetId: 'd1', targetT: 6.28, easing: 'linear' }] } };

describe('traced paths (R19)', () => {
  it('normalizes the trail and inspect reports where it starts and how long it is', async () => {
    const s = session();
    expect(s.propose([curve, dot({ fadeSeconds: 1, width: 2 }), move])).toMatchObject({ ok: true });
    expect((s.scene().get('d1') as GraphDotItem).dot.trace).toEqual({ width: 2, fadeSeconds: 1 });
    const out = await runLoopTool({ id: 'x', name: 'inspect_scene', input: { itemIds: ['d1'], times: [1.5, 4] } }, s, {});
    const rows = JSON.parse(out.result.text).items[0].at;
    expect(rows[0].trail).toBeUndefined(); // not moved yet: one point
    expect(rows[1].trail.graphLength).toBeGreaterThan(0.5);
    const exp = await runLoopTool({ id: 'y', name: 'check_export', input: {} }, s, {});
    expect(JSON.parse(exp.result.text)).toMatchObject({ ok: true });
  });

  it('accepts true and removes with null, rejects a bad fade', () => {
    const s = session();
    expect(s.propose([curve, dot(true)])).toMatchObject({ ok: true });
    expect((s.scene().get('d1') as GraphDotItem).dot.trace).toEqual({});
    expect(s.propose([{ action: 'UPDATE', itemId: 'd1', updates: { dot: { trace: null } } }])).toMatchObject({ ok: true });
    expect((s.scene().get('d1') as GraphDotItem).dot.trace).toBeUndefined();
    s.reset();
    const bad = s.propose([curve, dot({ fadeSeconds: -1 })]);
    expect(bad.ok ? '' : bad.errors.join('\n')).toMatch(/trace\.fadeSeconds must be a number of seconds/);
  });

  it('is in both schemas and the recipes', () => {
    const anyOf = AGENT_CHAT_RESPONSE_JSON_SCHEMA.properties.actions.items.anyOf as unknown as { properties: Record<string, { properties?: Record<string, unknown> }> }[];
    const gemini = GEMINI_RESPONSE_SCHEMA.properties.actions.items.properties;
    for (const schema of [anyOf[0]!.properties.item!.properties!, anyOf[1]!.properties.updates!.properties!, gemini.item.properties as Record<string, unknown>, gemini.updates.properties as Record<string, unknown>]) {
      expect(schema).toHaveProperty('dot.properties.trace.properties.fadeSeconds.type', 'number');
    }
    expect(buildSystemPrompt('', 'loop')).toContain('R19. Traced path');
  });
});
