import { describe, expect, it } from 'vitest';
import { createAxes, defaultSceneDefaults } from '@/store/factories';
import type { FrameDef, GraphAreaItem, ItemId, SceneItem } from '@/types/scene';
import { AGENT_CHAT_RESPONSE_JSON_SCHEMA } from '../types';
import { GEMINI_RESPONSE_SCHEMA } from '../providers/gemini';
import { buildSystemPrompt } from '../systemPrompt';
import { strayNames } from '../graphRegions';
import { DraftSession } from './draft';
import { runLoopTool } from './tools';

const frames: FrameDef[] = [{ id: 'home', col: 0, row: 0 }];

function session() {
  const ax1 = createAxes(defaultSceneDefaults());
  ax1.id = 'ax1';
  ax1.xRange = [-3, 3, 1];
  ax1.yRange = [-2, 9, 1];
  const ax2 = createAxes(defaultSceneDefaults());
  ax2.id = 'ax2';
  return new DraftSession({
    items: new Map<ItemId, SceneItem>([ax1, ax2].map((it) => [it.id, it])),
    frames,
    startFrameId: 'home',
    activeFrameId: 'home',
    defaults: defaultSceneDefaults(),
    audioItems: [],
    currentTimeSec: 0,
  });
}

const plot = (id: string, axesId = 'ax1', xDomain: [number, number] = [0, 3]) => ({
  action: 'CREATE',
  item: { id, kind: 'graphPlot', axesId, label: 'f', fn: { jsExpr: 'x*x', pyExpr: 'x**2' }, xDomain },
});
const area = (areaSpec: Record<string, unknown>, id = 'a1') => ({
  action: 'CREATE',
  item: { id, kind: 'graphArea', axesId: 'ax1', label: 'area', startTime: 2, duration: 1, area: areaSpec, fillOpacity: 0.4 },
});

async function tool(s: DraftSession, name: string, input: Record<string, unknown> = {}) {
  const out = await runLoopTool({ id: 'x', name, input }, s, {});
  return { ...out.result, json: JSON.parse(out.result.text) };
}

function errorsOf(s: DraftSession, actions: unknown[]): string {
  const r = s.propose(actions);
  expect(r.ok).toBe(false);
  return r.ok ? '' : r.errors.join('\n');
}

describe('Shaded areas (R12)', () => {
  it('creates an area under a plot and reports its integral and a label spot', async () => {
    const s = session();
    expect(s.propose([plot('p1'), area({ areaKind: 'underCurve', xMin: 1, xMax: 3, curve: { plotId: 'p1' } })])).toMatchObject({ ok: true });
    const a1 = s.scene().get('a1') as GraphAreaItem;
    expect(a1.mode).toEqual({ areaKind: 'underCurve', xMin: 1, xMax: 3, curve: { sourceKind: 'plot', plotId: 'p1' }, showBoundaryPlot: false });
    const facts = (await tool(s, 'inspect_scene', { itemIds: ['a1'], times: [3] })).json;
    expect(facts.items[0].area).toMatchObject({ areaKind: 'underCurve', x: [1, 3], value: 8.667, labelAt: [2, 2] });
    expect(facts.items[0].area.labelAtWorld).toHaveLength(2);
    expect((await tool(s, 'check_export')).json).toMatchObject({ ok: true });
  });

  it('checks the interval, the plot and its axes', () => {
    const s = session();
    expect(errorsOf(s, [plot('p1'), area({ areaKind: 'underCurve', xMin: 1, xMax: 4, curve: { plotId: 'p1' } })])).toMatch(/leaves plot "p1"'s domain \[0, 3\]/);
    expect(errorsOf(s, [plot('p1'), area({ areaKind: 'underCurve', xMin: 2, xMax: 1, curve: { plotId: 'p1' } })])).toMatch(/xMin \(2\) must be less than xMax \(1\)/);
    expect(errorsOf(s, [plot('p2', 'ax2', [-1, 1]), area({ areaKind: 'underCurve', xMin: 0, xMax: 1, curve: { plotId: 'p2' } })])).toMatch(/both must use the same axes/);
    expect(errorsOf(s, [area({ areaKind: 'underCurve', xMin: 0, xMax: 1, curve: { jsExpr: 'k*x' } })])).toMatch(/uses k; only x are allowed/);
  });

  it('measures the region between two expression curves and merges an UPDATE into the stored geometry', async () => {
    const s = session();
    const between = area({ areaKind: 'betweenCurves', xMin: 0, xMax: 1, lower: { jsExpr: 'x*x' }, upper: { pyExpr: 'np.sqrt(x)' } });
    expect(s.propose([between])).toMatchObject({ ok: true });
    expect((await tool(s, 'inspect_scene', { itemIds: ['a1'] })).json.items[0].area.value).toBeCloseTo(1 / 3, 2);
    expect(s.propose([{ action: 'UPDATE', itemId: 'a1', updates: { area: { xMax: 0.5 }, fillOpacity: 3 } }])).toMatchObject({ ok: true });
    const a1 = s.scene().get('a1') as GraphAreaItem;
    expect(a1.mode).toMatchObject({ areaKind: 'betweenCurves', xMin: 0, xMax: 0.5, upper: { sourceKind: 'expr', jsExpr: 'Math.sqrt(x)', pyExpr: 'np.sqrt(x)' } });
    expect(a1.fillOpacity).toBe(1);
  });
});

describe('Vector and slope fields (R13)', () => {
  const slopeField = (extra: Record<string, unknown> = {}) => ({
    action: 'CREATE',
    item: { id: 'f1', kind: 'graphField', axesId: 'ax1', label: 'slope field', startTime: 0, duration: 2, fieldMode: 'slope', jsExprSlope: 'x - y', pyExprSlope: 'x - y', ...extra },
  });

  it('creates a slope field and reports arrows and where a stream line ends', async () => {
    const s = session();
    expect(s.propose([slopeField({ streamPoints: [{ x: -1, y: 0.8 }] })])).toMatchObject({ ok: true });
    const short = (await tool(s, 'inspect_scene', { itemIds: ['f1'] })).json.items[0].field;
    expect(short.arrows).toBe(13 * 23);
    expect(short.streams[0]).toMatchObject({ from: [-1, 0.8], endedBy: 'streamVirtualTime ran out' });
    expect(short.streams[0].to[0]).toBeCloseTo(0.5, 0); // 3 s × 0.5 units/s, mostly along x

    s.reset();
    expect(s.propose([slopeField({ streamPoints: [{ x: -1, y: 0.8 }], streamVirtualTime: 12 })])).toMatchObject({ ok: true });
    const long = (await tool(s, 'inspect_scene', { itemIds: ['f1'] })).json.items[0].field;
    expect(long.streams[0].endedBy).toBe('left the axes');
    expect((await tool(s, 'check_export')).json).toMatchObject({ ok: true });
  });

  it('rejects fields with other names, missing components, too many arrows or seeds off the axes', () => {
    const s = session();
    expect(errorsOf(s, [slopeField({ jsExprSlope: 'x - t', pyExprSlope: 'x - t' })])).toMatch(/slope expression "x - t" uses t; only x and y are allowed/);
    expect(errorsOf(s, [{ action: 'CREATE', item: { id: 'f2', kind: 'graphField', axesId: 'ax1', label: 'v', fieldMode: 'vector', jsExprP: '-y' } }])).toMatch(/needs both components/);
    expect(errorsOf(s, [slopeField({ fieldGridStep: 0.1 })])).toMatch(/draws \d+ arrows .* use a larger step/);
    expect(errorsOf(s, [slopeField({ streamPoints: [{ x: 5, y: 0 }] })])).toMatch(/streamPoints\[0\] \(5, 0\) is outside the axes/);
  });

  it('finds stray names but not functions or constants after a dot', () => {
    expect(strayNames('Math.sin(x) * Math.PI + np.exp(y) + 1e-3', ['x', 'y'])).toEqual([]);
    expect(strayNames('a*x + sin(y)', ['x', 'y'])).toEqual(['a', 'sin']);
  });
});

describe('schemas and prompt', () => {
  it('declares area and field properties in both schemas, for CREATE and UPDATE', () => {
    const anyOf = AGENT_CHAT_RESPONSE_JSON_SCHEMA.properties.actions.items.anyOf as unknown as { properties: Record<string, { properties?: Record<string, unknown> }> }[];
    const gemini = GEMINI_RESPONSE_SCHEMA.properties.actions.items.properties;
    for (const schema of [anyOf[0]!.properties.item!.properties!, anyOf[1]!.properties.updates!.properties!, gemini.item.properties as Record<string, unknown>, gemini.updates.properties as Record<string, unknown>]) {
      expect(schema).toHaveProperty('area.properties.areaKind.enum');
      expect(schema).toHaveProperty('area.properties.curve.properties.plotId');
      expect(schema).toHaveProperty('fieldMode');
      expect(schema).toHaveProperty('streamPoints');
    }
    expect(gemini.item.properties.kind.enum).toEqual(expect.arrayContaining(['graphArea', 'graphField']));
  });

  it('teaches areas and fields in both modes', () => {
    for (const prompt of [buildSystemPrompt(''), buildSystemPrompt('', 'loop')]) {
      expect(prompt).toContain('8f. Shaded areas');
      expect(prompt).toContain('8g. Vector and slope fields');
      expect(prompt).toContain('R12. Shaded area labelled as an integral');
      expect(prompt).toContain('R13. Slope or vector field with a solution');
      expect(prompt).toContain('"$\\int_{1}^{3} f(x)\\,dx$"');
      expect(prompt).not.toContain('not agent-created');
    }
  });
});
