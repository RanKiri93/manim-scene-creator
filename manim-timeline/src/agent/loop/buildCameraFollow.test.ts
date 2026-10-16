import { describe, expect, it } from 'vitest';
import { createAxes, defaultSceneDefaults } from '@/store/factories';
import type { CameraMoveItem, FrameDef, ItemId, SceneItem } from '@/types/scene';
import { AGENT_CHAT_RESPONSE_JSON_SCHEMA } from '../types';
import { GEMINI_RESPONSE_SCHEMA } from '../providers/gemini';
import { buildSystemPrompt } from '../systemPrompt';
import { DraftSession } from './draft';
import { runLoopTool } from './tools';

const frames: FrameDef[] = [{ id: 'home', col: 0, row: 0 }];

function session() {
  const ax = createAxes(defaultSceneDefaults());
  ax.id = 'ax';
  ax.xRange = [0, 20, 5];
  ax.yRange = [0, 2, 1];
  ax.scaleX = 0.6;
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

const base = [
  { action: 'CREATE', item: { id: 'p1', kind: 'graphPlot', axesId: 'ax', label: 'f', startTime: 0, duration: 1, fn: { jsExpr: '0.1*x', pyExpr: '0.1*x' }, xDomain: [0, 20] } },
  { action: 'CREATE', item: { id: 'd1', kind: 'graphDot', axesId: 'ax', label: 'P', startTime: 1, duration: 0.5, dot: { attachment: { kind: 'function', graphPlotId: 'p1', x: 0 } } } },
  { action: 'CREATE', item: { id: 'm1', kind: 'target_animation', label: 'go', mode: 'graphFollow', startTime: 2, duration: 4, targets: [{ targetId: 'd1', targetX: 20, easing: 'linear' }] } },
];
const follow = (extra: Record<string, unknown> = {}) => ({
  action: 'CREATE',
  item: { id: 'c1', kind: 'camera_move', label: 'follow', startTime: 2, duration: 4, targetMode: 'follow', targetId: 'd1', ...extra },
});

describe('camera follows a point (R20)', () => {
  it('resolves targetMode "follow" into a follow clip and inspect keeps the dot centred', async () => {
    const s = session();
    expect(s.propose([...base, follow({ targetWidth: 6 })])).toMatchObject({ ok: true });
    const cam = s.scene().get('c1') as CameraMoveItem;
    expect(cam).toMatchObject({ follow: { targetId: 'd1' }, targetWidth: 6, targetFrameId: 'home', offsetX: 0, offsetY: 0 });
    expect(cam).not.toHaveProperty('targetMode');
    const out = await runLoopTool({ id: 'x', name: 'inspect_scene', input: { itemIds: ['d1'], times: [4] } }, s, {});
    const facts = JSON.parse(out.result.text);
    const dotAt = facts.items[0].at[0].world as [number, number];
    expect(JSON.stringify(facts)).toContain('"width":6');
    expect(JSON.stringify(facts)).toContain(`"center":[${dotAt[0]},${dotAt[1]}]`);
    const exp = await runLoopTool({ id: 'y', name: 'check_export', input: {} }, s, {});
    expect(JSON.parse(exp.result.text)).toMatchObject({ ok: true });
  });

  it('refuses a follow that starts before its target appears or targets a clip', () => {
    const s = session();
    const early = s.propose([...base, follow({ startTime: 0.5 })]);
    expect(early.ok ? '' : early.errors.join('\n')).toMatch(/before "d1" appears/);
    s.reset();
    const clip = s.propose([...base, follow({ targetId: 'm1' })]);
    expect(clip.ok ? '' : clip.errors.join('\n')).toMatch(/can follow a graph dot/);
  });

  it('offers follow in both schemas and teaches it', () => {
    const anyOf = AGENT_CHAT_RESPONSE_JSON_SCHEMA.properties.actions.items.anyOf as unknown as { properties: Record<string, { properties?: Record<string, { enum?: string[] }> }> }[];
    const gemini = GEMINI_RESPONSE_SCHEMA.properties.actions.items.properties as unknown as Record<string, { properties: Record<string, { enum?: string[] }> }>;
    for (const enumValues of [anyOf[0]!.properties.item!.properties!.targetMode!.enum, anyOf[1]!.properties.updates!.properties!.targetMode!.enum, gemini.item!.properties.targetMode!.enum, gemini.updates!.properties.targetMode!.enum]) {
      expect(enumValues).toContain('follow');
    }
    const prompt = buildSystemPrompt('', 'loop');
    expect(prompt).toContain('"follow" (exact targetId of a graph dot or object that MOVES during the clip');
    expect(prompt).toContain('R20. Camera follows a point');
  });
});
