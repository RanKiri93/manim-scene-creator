import { describe, expect, it } from 'vitest';
import { defaultSceneDefaults } from '@/store/factories';
import type { FrameDef, ItemId, SceneItem, ShapeItem } from '@/types/scene';
import { AGENT_CHAT_RESPONSE_JSON_SCHEMA } from '../types';
import { GEMINI_RESPONSE_SCHEMA } from '../providers/gemini';
import { buildSystemPrompt } from '../systemPrompt';
import { DraftSession } from './draft';
import { runLoopTool } from './tools';

const frames: FrameDef[] = [{ id: 'home', col: 0, row: 0 }];

function session() {
  return new DraftSession({
    items: new Map<ItemId, SceneItem>(),
    frames,
    startFrameId: 'home',
    activeFrameId: 'home',
    defaults: defaultSceneDefaults(),
    audioItems: [],
    currentTimeSec: 0,
  });
}

const point = (id: string, x: number, y: number) => ({
  action: 'CREATE',
  item: { id, kind: 'shape', shapeType: 'circle', label: id, startTime: 0, duration: 0.3, x, y, radius: 0.06, fillColor: '#ffffff', fillOpacity: 1, strokeColor: '#ffffff' },
});
const obj = (itemId: string) => ({ kind: 'object', itemId });
const triangle = [
  point('A', -1, 1.5),
  point('B', -1, -1),
  point('C', 1.5, -1),
  { action: 'CREATE', item: { id: 'ab', kind: 'shape', shapeType: 'line', label: 'AB', startTime: 0.5, duration: 0.5, endpoints: { start: obj('A'), end: obj('B'), ticks: 1 } } },
  { action: 'CREATE', item: { id: 'bc', kind: 'shape', shapeType: 'line', label: 'BC', startTime: 0.5, duration: 0.5, endpoints: { start: obj('B'), end: obj('C'), ticks: 1 } } },
  { action: 'CREATE', item: { id: 'ca', kind: 'shape', shapeType: 'line', label: 'CA', startTime: 0.5, duration: 0.5, endpoints: { start: obj('C'), end: obj('A') } } },
  { action: 'CREATE', item: { id: 'atB', kind: 'shape', label: 'right angle', startTime: 1, duration: 0.5, angle: { vertex: obj('B'), from: obj('A'), to: obj('C'), radius: 0.3 } } },
  { action: 'CREATE', item: { id: 'atA', kind: 'shape', label: 'alpha', startTime: 1, duration: 0.5, angle: { vertex: obj('A'), from: obj('B'), to: obj('C') } } },
];

describe('geometry marks (R22)', () => {
  it('builds a right isosceles triangle and inspect reports angles, lengths and a label spot', async () => {
    const s = session();
    expect(s.propose(triangle)).toMatchObject({ ok: true });
    const atB = s.scene().get('atB') as ShapeItem;
    expect(atB).toMatchObject({ shapeType: 'polyline', angle: { radius: 0.3, mark: 'auto' }, headArrow: false });
    expect(atB.points).toHaveLength(3); // static geometry synced: the square
    expect((s.scene().get('ab') as ShapeItem).endpoints?.ticks).toBe(1);
    const out = await runLoopTool({ id: 'x', name: 'inspect_scene', input: { itemIds: ['atB', 'atA', 'ab', 'bc'], times: [2] } }, s, {});
    const items = JSON.parse(out.result.text).items as { id: string; at: Record<string, unknown>[] }[];
    const at = (id: string) => items.find((it) => it.id === id)!.at[0]!;
    expect(at('atB')).toMatchObject({ angleDegrees: 90, rightAngle: true });
    expect(at('atA')).toMatchObject({ angleDegrees: 45, rightAngle: false });
    expect(at('atA').labelAtWorld).toHaveLength(2);
    expect(at('ab').length).toBe(at('bc').length);
    const exp = await runLoopTool({ id: 'y', name: 'check_export', input: {} }, s, {});
    expect(JSON.parse(exp.result.text)).toMatchObject({ ok: true });
  });

  it('rejects bad marks and ticks', () => {
    const s = session();
    const errs = (actions: unknown[]) => {
      const r = s.propose(actions);
      s.reset();
      return r.ok ? '' : r.errors.join('\n');
    };
    expect(errs([...triangle.slice(0, 3), { action: 'CREATE', item: { id: 'x', kind: 'shape', shapeType: 'circle', angle: { vertex: obj('B'), from: obj('A'), to: obj('C') } } }])).toMatch(/angle needs shapeType "polyline"/);
    expect(errs([...triangle.slice(0, 3), { action: 'CREATE', item: { id: 'x', kind: 'shape', angle: { vertex: obj('B'), from: obj('A'), to: obj('C'), mark: 'wedge' } } }])).toMatch(/mark must be "auto", "arc" or "right"/);
    expect(errs([...triangle.slice(0, 3), { action: 'CREATE', item: { id: 'x', kind: 'shape', angle: { vertex: obj('B'), from: obj('B'), to: obj('C') } } }])).toMatch(/angle mark "x": .*zero length/);
    expect(errs([...triangle.slice(0, 3), { action: 'CREATE', item: { id: 'x', kind: 'shape', shapeType: 'line', endpoints: { start: obj('A'), end: obj('B'), ticks: 5 } } }])).toMatch(/ticks must be 0, 1, 2 or 3/);
  });

  it('is in both schemas and the prompt', () => {
    const anyOf = AGENT_CHAT_RESPONSE_JSON_SCHEMA.properties.actions.items.anyOf as unknown as { properties: Record<string, { properties?: Record<string, unknown> }> }[];
    const gemini = GEMINI_RESPONSE_SCHEMA.properties.actions.items.properties;
    for (const schema of [anyOf[0]!.properties.item!.properties!, anyOf[1]!.properties.updates!.properties!, gemini.item.properties as Record<string, unknown>, gemini.updates.properties as Record<string, unknown>]) {
      expect(schema).toHaveProperty('angle.properties.vertex');
      expect(schema).toHaveProperty('angle.properties.mark.enum', ['auto', 'arc', 'right']);
      expect(schema).toHaveProperty('endpoints.properties.ticks.type', 'integer');
    }
    const prompt = buildSystemPrompt('', 'loop');
    expect(prompt).toContain('R22. Geometry construction');
    expect(prompt).toContain('Angle marks: a `shape` with');
  });
});
