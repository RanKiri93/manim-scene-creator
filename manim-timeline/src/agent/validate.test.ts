import { describe, expect, it } from 'vitest';
import type {
  AxesItem,
  GraphFunctionSeriesItem,
  SceneItem,
  TextLineItem,
} from '@/types/scene';
import { functionSeriesTotalDuration } from '@/types/scene';
import { validateAgentResponse } from './validate';

function axes(id = 'ax1'): AxesItem {
  return {
    id,
    kind: 'axes',
    label: '',
    layer: 0,
    startTime: 0,
    duration: 2,
    x: 0,
    y: 0,
    scale: 1,
    scaleX: 1,
    scaleY: 1,
    posSteps: [{ kind: 'absolute' }],
    audioTrackId: null,
    xRange: [-5, 5, 1],
    yRange: [-3, 3, 1],
    xLabel: 'x',
    yLabel: 'y',
    includeNumbers: false,
    includeTip: true,
  };
}

function textLine(id = 'tl1'): TextLineItem {
  return {
    id,
    kind: 'textLine',
    label: '',
    layer: 0,
    startTime: 0,
    duration: 3,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    audioTrackId: null,
    raw: '',
    font: 'Arial',
    fontSize: 32,
    segments: [],
    measure: null,
    measureError: null,
    previewDataUrl: null,
    segmentMeasures: null,
    mathChildMeasures: null,
  };
}

describe('validateAgentResponse', () => {
  it('accepts a valid CREATE + UPDATE + DELETE sequence', () => {
    const map = new Map<string, SceneItem>();
    map.set('tl1', textLine('tl1'));
    const resp = {
      reply: 'add axes',
      actions: [
        {
          action: 'CREATE',
          item: {
            id: 'ax1',
            kind: 'axes',
            startTime: 1.5,
            duration: 2,
          },
        },
        {
          action: 'UPDATE',
          itemId: 'tl1',
          updates: { duration: 5 },
        },
        { action: 'DELETE', itemId: 'tl1' },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.actions).toHaveLength(3);
    const created = result.response.actions[0];
    expect(created.action).toBe('CREATE');
    if (created.action === 'CREATE' && created.item.kind === 'axes') {
      expect(created.item.posSteps).toEqual([{ kind: 'absolute' }]);
      expect(created.item.layer).toBe(0);
    }
  });

  it('normalizes to_edge bounds on UPDATE posSteps', () => {
    const map = new Map<string, SceneItem>();
    map.set('tl1', textLine('tl1'));
    const result = validateAgentResponse(
      {
        reply: 'align visible ink right',
        actions: [
          {
            action: 'UPDATE',
            itemId: 'tl1',
            updates: {
              posSteps: [{ kind: 'to_edge', edge: 'RIGHT', buff: 0.4, bounds: 'ink' }],
            },
          },
        ],
      },
      map,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const action = result.response.actions[0];
    expect(action.action).toBe('UPDATE');
    if (action.action === 'UPDATE') {
      expect((action.updates as Record<string, unknown>).posSteps).toEqual([
        { kind: 'to_edge', edge: 'RIGHT', buff: 0.4, bounds: 'ink' },
      ]);
    }
  });

  it('rejects a dangling axesId on graphPlot', () => {
    const map = new Map<string, SceneItem>();
    const resp = {
      reply: 'update scene',
      actions: [
        {
          action: 'CREATE',
          item: {
            id: 'p1',
            kind: 'graphPlot',
            axesId: 'missing',
            fn: {},
            startTime: 0,
            duration: 1,
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toMatch(/axesId/);
    }
  });

  it('accepts graphPlot when axes is created in the same response', () => {
    const map = new Map<string, SceneItem>();
    const resp = {
      reply: 'update scene',
      actions: [
        {
          action: 'CREATE',
          item: {
            id: 'ax1',
            kind: 'axes',
          },
        },
        {
          action: 'CREATE',
          item: {
            id: 'p1',
            kind: 'graphPlot',
            axesId: 'ax1',
            fn: { jsExpr: 'Math.sin(x)', pyExpr: 'np.sin(x)' },
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(true);
  });

  it('rejects disallowed kinds (graphArea) in v1', () => {
    const map = new Map<string, SceneItem>();
    map.set('ax1', axes('ax1'));
    const resp = {
      reply: 'update scene',
      actions: [
        {
          action: 'CREATE',
          item: {
            id: 'ga1',
            kind: 'graphArea',
            axesId: 'ax1',
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toMatch(/whitelist/);
    }
  });

  it('rejects UI-only field leakage on CREATE', () => {
    const map = new Map<string, SceneItem>();
    const resp = {
      reply: 'update scene',
      actions: [
        {
          action: 'CREATE',
          item: {
            id: 'tl2',
            kind: 'textLine',
            measure: { width: 1 },
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toMatch(/measure/);
    }
  });

  it('rejects UPDATE when the target does not exist', () => {
    const map = new Map<string, SceneItem>();
    const resp = {
      reply: 'update scene',
      actions: [
        { action: 'UPDATE', itemId: 'missing', updates: { duration: 4 } },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(false);
  });

  it('rejects id changes through UPDATE', () => {
    const map = new Map<string, SceneItem>();
    map.set('tl1', textLine('tl1'));
    const resp = {
      reply: 'update scene',
      actions: [
        {
          action: 'UPDATE',
          itemId: 'tl1',
          updates: { id: 'tl2' },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toMatch(/id/);
    }
  });

  it('dedupes exact-duplicate CREATE ids instead of failing', () => {
    const map = new Map<string, SceneItem>();
    const resp = {
      reply: 'update scene',
      actions: [
        { action: 'CREATE', item: { id: 'dup', kind: 'axes' } },
        { action: 'CREATE', item: { id: 'dup', kind: 'axes' } },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response.actions.length).toBe(1);
    }
  });

  it('rejects duplicate CREATE ids with different bodies', () => {
    const map = new Map<string, SceneItem>();
    const resp = {
      reply: 'update scene',
      actions: [
        { action: 'CREATE', item: { id: 'dup', kind: 'axes' } },
        { action: 'CREATE', item: { id: 'dup', kind: 'axes', label: 'other' } },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('different content'))).toBe(true);
    }
  });

  it('auto-links missing axesId on graphPlot when exactly one axes is created', () => {
    const map = new Map<string, SceneItem>();
    const resp = {
      reply: 'update scene',
      actions: [
        { action: 'CREATE', item: { id: 'ax_new', kind: 'axes' } },
        {
          action: 'CREATE',
          item: {
            id: 'p1',
            kind: 'graphPlot',
            fn: { jsExpr: 'x*x', pyExpr: 'x**2' },
            xDomain: [-1, 1],
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const plot = result.response.actions[1]!;
      expect(plot.action).toBe('CREATE');
      if (plot.action === 'CREATE' && plot.item.kind === 'graphPlot') {
        expect(plot.item.axesId).toBe('ax_new');
      }
    }
  });

  it('recovers graphPlot fn expression from aliases and derives missing dialect', () => {
    const map = new Map<string, SceneItem>();
    const resp = {
      reply: 'update scene',
      actions: [
        { action: 'CREATE', item: { id: 'ax', kind: 'axes' } },
        {
          action: 'CREATE',
          item: {
            id: 'p_alias',
            kind: 'graphPlot',
            axesId: 'ax',
            fn: { expr: 'x^2' },
          },
        },
        {
          action: 'CREATE',
          item: {
            id: 'p_bare',
            kind: 'graphPlot',
            axesId: 'ax',
            fn: 'Math.sin(x)',
          },
        },
        {
          action: 'CREATE',
          item: {
            id: 'p_jsonly',
            kind: 'graphPlot',
            axesId: 'ax',
            fn: { jsExpr: 'Math.cos(x)' },
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [, alias, bare, jsonly] = result.response.actions;
    if (alias?.action === 'CREATE' && alias.item.kind === 'graphPlot') {
      expect(alias.item.fn.jsExpr).toBe('x**2');
      expect(alias.item.fn.pyExpr).toBe('x**2');
    }
    if (bare?.action === 'CREATE' && bare.item.kind === 'graphPlot') {
      expect(bare.item.fn.jsExpr).toBe('Math.sin(x)');
      expect(bare.item.fn.pyExpr).toBe('np.sin(x)');
    }
    if (jsonly?.action === 'CREATE' && jsonly.item.kind === 'graphPlot') {
      expect(jsonly.item.fn.jsExpr).toBe('Math.cos(x)');
      expect(jsonly.item.fn.pyExpr).toBe('np.cos(x)');
    }
  });

  it('rejects graphCurve CREATE without axesId', () => {
    const map = new Map<string, SceneItem>();
    const resp = {
      reply: 'curve',
      actions: [
        {
          action: 'CREATE',
          item: {
            id: 'gc1',
            kind: 'graphCurve',
            curve: {
              jsXExpr: 'Math.cos(t)',
              jsYExpr: 'Math.sin(t)',
              pyXExpr: 'np.cos(t)',
              pyYExpr: 'np.sin(t)',
            },
            tDomain: [0, 6.28],
          },
        },
      ],
    };
    expect(validateAgentResponse(resp, map).ok).toBe(false);
  });

  it('accepts graphCurve CREATE with valid axes and coordinates', () => {
    const map = new Map<string, SceneItem>();
    map.set('ax1', axes('ax1'));
    const resp = {
      reply: 'curve',
      actions: [
        {
          action: 'CREATE',
          item: {
            id: 'gc1',
            kind: 'graphCurve',
            axesId: 'ax1',
            curve: {
              jsXExpr: 'Math.cos(t)',
              jsYExpr: 'Math.sin(t)',
              pyXExpr: 'np.cos(t)',
              pyYExpr: 'np.sin(t)',
            },
            tDomain: [0, 6.28],
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(true);
  });

  it('auto-links missing axesId on graphCurve when exactly one axes is created', () => {
    const map = new Map<string, SceneItem>();
    const resp = {
      reply: 'curve',
      actions: [
        { action: 'CREATE', item: { id: 'ax_new', kind: 'axes' } },
        {
          action: 'CREATE',
          item: {
            id: 'gc1',
            kind: 'graphCurve',
            curve: {
              jsXExpr: 't',
              jsYExpr: 't',
              pyXExpr: 't',
              pyYExpr: 't',
            },
            tDomain: [0, 1],
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const c = result.response.actions[1]!;
      expect(c.action).toBe('CREATE');
      if (c.action === 'CREATE' && c.item.kind === 'graphCurve') {
        expect(c.item.axesId).toBe('ax_new');
      }
    }
  });

  it('rejects graphCurve when a coordinate expression is missing', () => {
    const map = new Map<string, SceneItem>();
    map.set('ax1', axes('ax1'));
    const resp = {
      reply: 'bad',
      actions: [
        {
          action: 'CREATE',
          item: {
            id: 'gc1',
            kind: 'graphCurve',
            axesId: 'ax1',
            curve: {
              jsXExpr: 't',
              pyXExpr: 't',
            },
            tDomain: [0, 1],
          },
        },
      ],
    };
    expect(validateAgentResponse(resp, map).ok).toBe(false);
  });

  it('accepts a pure-chat reply with empty actions array', () => {
    const map = new Map<string, SceneItem>();
    const resp = { reply: 'Sure, I can help with that.', actions: [] };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response.reply).toBe('Sure, I can help with that.');
      expect(result.response.actions).toEqual([]);
    }
  });

  it('accepts a pure-chat reply when actions is omitted', () => {
    const map = new Map<string, SceneItem>();
    const resp = { reply: 'What duration should the wave have?' };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response.actions).toEqual([]);
    }
  });

  it('rejects a response missing a non-empty reply', () => {
    const map = new Map<string, SceneItem>();
    const resp = { actions: [] };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(false);
  });

  it('accepts legacy rationale field as a reply fallback', () => {
    const map = new Map<string, SceneItem>();
    const resp = { rationale: 'legacy text', actions: [] };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.response.reply).toBe('legacy text');
  });

  it('surfaces a thinking field when the provider supplied one', () => {
    const map = new Map<string, SceneItem>();
    const resp = {
      reply: 'ok',
      actions: [],
      thinking: 'I am pondering axes ranges.',
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.response.thinking).toMatch(/pondering/);
  });

  it('accepts a graphFunctionSeries CREATE and fills missing sub-objects', () => {
    const map = new Map<string, SceneItem>();
    map.set('ax1', axes('ax1'));
    const resp = {
      reply: 'add series',
      actions: [
        {
          action: 'CREATE',
          item: {
            id: 'fs1',
            kind: 'graphFunctionSeries',
            axesId: 'ax1',
            jsExpr: 'x^n / n',
            nMin: 1,
            nMax: 4,
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const created = result.response.actions[0]!;
    expect(created.action).toBe('CREATE');
    if (created.action !== 'CREATE' || created.item.kind !== 'graphFunctionSeries') {
      throw new Error('unexpected action shape');
    }
    const fs = created.item;
    expect(fs.jsExpr).toBe('x**n / n');
    expect(fs.pyExpr).toBe('x**n / n');
    expect(fs.nMin).toBe(1);
    expect(fs.nMax).toBe(4);
    expect(fs.mode).toBe('accumulation');
    expect(fs.perN).toEqual({});
    expect(fs.defaults).toMatchObject({ color: '#3b82f6', lineStyle: 'solid' });
    expect(fs.duration).toBe(functionSeriesTotalDuration(fs));
  });

  it('accepts graphFunctionSeries CREATE with full basic fields (Copilot slice)', () => {
    const map = new Map<string, SceneItem>();
    map.set('ax1', axes('ax1'));
    const resp = {
      reply: 'add series',
      actions: [
        {
          action: 'CREATE',
          item: {
            id: 'series1',
            kind: 'graphFunctionSeries',
            axesId: 'ax1',
            jsExpr: 'Math.sin(n*x)/n',
            pyExpr: 'np.sin(n*x)/n',
            nMin: 1,
            nMax: 8,
            displayMode: 'individual',
            mode: 'accumulation',
            startTime: 0,
            duration: 4,
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const created = result.response.actions[0]!;
    expect(created.action).toBe('CREATE');
    if (created.action !== 'CREATE' || created.item.kind !== 'graphFunctionSeries') {
      throw new Error('unexpected action shape');
    }
    const fs = created.item;
    expect(fs.jsExpr).toBe('Math.sin(n*x)/n');
    expect(fs.pyExpr).toBe('np.sin(n*x)/n');
    expect(fs.nMin).toBe(1);
    expect(fs.nMax).toBe(8);
    expect(fs.displayMode).toBe('individual');
    expect(fs.mode).toBe('accumulation');
    expect(fs.startTime).toBe(0);
    expect(fs.duration).toBe(4);
    expect(fs.perN).toEqual({});
  });

  it('rejects graphField CREATE (not agent-whitelisted)', () => {
    const map = new Map<string, SceneItem>();
    map.set('ax1', axes('ax1'));
    const resp = {
      reply: 'field',
      actions: [
        {
          action: 'CREATE',
          item: {
            id: 'gf1',
            kind: 'graphField',
            axesId: 'ax1',
            fieldMode: 'vector',
            jsExprP: '1',
            pyExprP: '1',
            jsExprQ: '0',
            pyExprQ: '0',
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toMatch(/whitelist/);
    }
  });

  it('swaps nMin/nMax when the LLM reverses them', () => {
    const map = new Map<string, SceneItem>();
    map.set('ax1', axes('ax1'));
    const resp = {
      reply: 'series',
      actions: [
        {
          action: 'CREATE',
          item: {
            id: 'fs1',
            kind: 'graphFunctionSeries',
            axesId: 'ax1',
            jsExpr: 'Math.sin(n*x)',
            pyExpr: 'np.sin(n*x)',
            nMin: 7,
            nMax: 2,
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const act = result.response.actions[0]!;
    if (act.action !== 'CREATE' || act.item.kind !== 'graphFunctionSeries') {
      throw new Error('unexpected action shape');
    }
    expect(act.item.nMin).toBe(2);
    expect(act.item.nMax).toBe(7);
  });

  it('swaps nMin 8 and nMax 1 to 1..8', () => {
    const map = new Map<string, SceneItem>();
    map.set('ax1', axes('ax1'));
    const resp = {
      reply: 'series',
      actions: [
        {
          action: 'CREATE',
          item: {
            id: 'fs1',
            kind: 'graphFunctionSeries',
            axesId: 'ax1',
            jsExpr: 'x**n',
            pyExpr: 'x**n',
            nMin: 8,
            nMax: 1,
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const act = result.response.actions[0]!;
    if (act.action !== 'CREATE' || act.item.kind !== 'graphFunctionSeries') {
      throw new Error('unexpected action shape');
    }
    expect(act.item.nMin).toBe(1);
    expect(act.item.nMax).toBe(8);
  });

  it('rejects graphFunctionSeries with no resolvable axesId', () => {
    const map = new Map<string, SceneItem>();
    const resp = {
      reply: 'series',
      actions: [
        {
          action: 'CREATE',
          item: {
            id: 'fs1',
            kind: 'graphFunctionSeries',
            jsExpr: 'Math.sin(n*x)',
            pyExpr: 'np.sin(n*x)',
            nMin: 1,
            nMax: 3,
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /axesId is required/.test(e))).toBe(true);
    }
  });

  it('rejects graphFunctionSeries when axesId points at no axes', () => {
    const map = new Map<string, SceneItem>();
    map.set('ax1', axes('ax1'));
    const resp = {
      reply: 'series',
      actions: [
        {
          action: 'CREATE',
          item: {
            id: 'fs1',
            kind: 'graphFunctionSeries',
            axesId: 'ghost_axes',
            jsExpr: 'Math.sin(n*x)',
            pyExpr: 'np.sin(n*x)',
            nMin: 1,
            nMax: 3,
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toMatch(/axesId/);
    }
  });

  it('rejects graphFunctionSeries CREATE with no expressions', () => {
    const map = new Map<string, SceneItem>();
    map.set('ax1', axes('ax1'));
    const resp = {
      reply: 'series',
      actions: [
        {
          action: 'CREATE',
          item: {
            id: 'fs1',
            kind: 'graphFunctionSeries',
            axesId: 'ax1',
            nMin: 1,
            nMax: 3,
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /graphFunctionSeries/.test(e))).toBe(true);
    }
  });

  it('recovers graphFunctionSeries jsExpr/pyExpr from top-level expr alias', () => {
    const map = new Map<string, SceneItem>();
    map.set('ax1', axes('ax1'));
    const resp = {
      reply: 'series',
      actions: [
        {
          action: 'CREATE',
          item: {
            id: 'fs1',
            kind: 'graphFunctionSeries',
            axesId: 'ax1',
            expr: 'x^n',
            nMin: 0,
            nMax: 3,
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const act = result.response.actions[0]!;
    if (act.action !== 'CREATE' || act.item.kind !== 'graphFunctionSeries') {
      throw new Error('unexpected action shape');
    }
    expect(act.item.jsExpr).toBe('x**n');
    expect(act.item.pyExpr).toBe('x**n');
    expect(act.item.nMin).toBe(0);
    expect(act.item.nMax).toBe(3);
  });

  it('auto-links axesId for graphFunctionSeries when exactly one axes is created', () => {
    const map = new Map<string, SceneItem>();
    const resp = {
      reply: 'series',
      actions: [
        { action: 'CREATE', item: { id: 'ax_new', kind: 'axes' } },
        {
          action: 'CREATE',
          item: {
            id: 'fs1',
            kind: 'graphFunctionSeries',
            jsExpr: 'Math.sin(n*x)',
            pyExpr: 'np.sin(n*x)',
            nMin: 1,
            nMax: 3,
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fsAction = result.response.actions[1]!;
    if (fsAction.action !== 'CREATE' || fsAction.item.kind !== 'graphFunctionSeries') {
      throw new Error('unexpected action shape');
    }
    expect(fsAction.item.axesId).toBe('ax_new');
    expect(fsAction.item.duration).toBe(functionSeriesTotalDuration(fsAction.item));
  });

  it('normalizes perN UPDATE keys and maps waitAfterSec to waitAfter', () => {
    const map = new Map<string, SceneItem>();
    map.set('ax1', axes('ax1'));
    const existingFs: GraphFunctionSeriesItem = {
      id: 'fs1',
      kind: 'graphFunctionSeries',
      label: 'series',
      layer: 0,
      startTime: 0,
      duration: 5,
      x: 0,
      y: 0,
      scale: 1,
      posSteps: [{ kind: 'absolute' }],
      audioTrackId: null,
      axesId: 'ax1',
      jsExpr: 'Math.sin(n*x)',
      pyExpr: 'np.sin(n*x)',
      nMin: 1,
      nMax: 4,
      mode: 'accumulation',
      displayMode: 'individual',
      xDomain: null,
      defaults: {
        color: '#3b82f6',
        strokeWidth: 4,
        lineStyle: 'solid',
        animDuration: 1,
        waitAfter: 0.3,
      },
      perN: {},
      perNErrors: {},
      topLevelError: null,
    };
    map.set('fs1', existingFs);
    const resp = {
      reply: 'color curve 3',
      actions: [
        {
          action: 'UPDATE',
          itemId: 'fs1',
          updates: {
            perN: {
              '3': { color: '#FF0000', waitAfterSec: 1 },
              garbage: { color: '#fff' },
            },
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const act = result.response.actions[0]!;
    if (act.action !== 'UPDATE') throw new Error('expected UPDATE');
    const perN = (act.updates as Partial<GraphFunctionSeriesItem>).perN;
    expect(perN).toEqual({ '3': { color: '#FF0000', waitAfter: 1 } });
  });

  it('accepts an exit_animation targeting a graphFunctionSeries', () => {
    const map = new Map<string, SceneItem>();
    map.set('ax1', axes('ax1'));
    const existingFs: GraphFunctionSeriesItem = {
      id: 'fs1',
      kind: 'graphFunctionSeries',
      label: 'series',
      layer: 0,
      startTime: 0,
      duration: 5,
      x: 0,
      y: 0,
      scale: 1,
      posSteps: [{ kind: 'absolute' }],
      audioTrackId: null,
      axesId: 'ax1',
      jsExpr: 'Math.sin(n*x)',
      pyExpr: 'np.sin(n*x)',
      nMin: 1,
      nMax: 4,
      mode: 'accumulation',
      displayMode: 'individual',
      xDomain: null,
      defaults: {
        color: '#3b82f6',
        strokeWidth: 4,
        lineStyle: 'solid',
        animDuration: 1,
        waitAfter: 0.3,
      },
      perN: {},
      perNErrors: {},
      topLevelError: null,
    };
    map.set('fs1', existingFs);
    const resp = {
      reply: 'fade the series out',
      actions: [
        {
          action: 'CREATE',
          item: {
            id: 'ex1',
            kind: 'exit_animation',
            label: 'יציאת סדרה',
            startTime: 6,
            duration: 1,
            targets: [{ targetId: 'fs1', animStyle: 'uncreate' }],
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ex = result.response.actions[0]!;
    if (ex.action !== 'CREATE' || ex.item.kind !== 'exit_animation') {
      throw new Error('expected exit_animation CREATE');
    }
    expect(ex.item.targets).toEqual([
      { targetId: 'fs1', animStyle: 'uncreate' },
    ]);
  });

  it('accepts an exit_animation targeting a function series created in the same batch', () => {
    const map = new Map<string, SceneItem>();
    map.set('ax1', axes('ax1'));
    const resp = {
      reply: 'series and its exit',
      actions: [
        {
          action: 'CREATE',
          item: {
            id: 'fs1',
            kind: 'graphFunctionSeries',
            axesId: 'ax1',
            jsExpr: 'Math.sin(n*x)',
            pyExpr: 'np.sin(n*x)',
            nMin: 1,
            nMax: 3,
          },
        },
        {
          action: 'CREATE',
          item: {
            id: 'ex1',
            kind: 'exit_animation',
            label: 'יציאה',
            startTime: 6,
            duration: 1,
            targets: [{ targetId: 'fs1', animStyle: 'fade_out' }],
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(true);
  });

  it('rejects an exit_animation whose targetId does not exist', () => {
    const map = new Map<string, SceneItem>();
    const resp = {
      reply: 'bad exit',
      actions: [
        {
          action: 'CREATE',
          item: {
            id: 'ex1',
            kind: 'exit_animation',
            label: 'x',
            startTime: 1,
            duration: 1,
            targets: [{ targetId: 'missing', animStyle: 'fade_out' }],
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some((e) => /unknown item "missing"/.test(e)),
      ).toBe(true);
    }
  });

  it('coerces an unknown animStyle to fade_out', () => {
    const map = new Map<string, SceneItem>();
    map.set('tl1', textLine('tl1'));
    const resp = {
      reply: 'exit',
      actions: [
        {
          action: 'CREATE',
          item: {
            id: 'ex1',
            kind: 'exit_animation',
            label: 'x',
            startTime: 5,
            duration: 1,
            targets: [{ targetId: 'tl1', animStyle: 'explode' }],
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ex = result.response.actions[0]!;
    if (ex.action !== 'CREATE' || ex.item.kind !== 'exit_animation') {
      throw new Error('expected exit_animation CREATE');
    }
    expect(ex.item.targets[0]!.animStyle).toBe('fade_out');
  });

  it('accepts a blink_animation targeting a text line', () => {
    const map = new Map<string, SceneItem>([['tl1', textLine('tl1')]]);
    const resp = {
      reply: 'blink',
      actions: [
        {
          action: 'CREATE',
          item: {
            id: 'b1',
            kind: 'blink_animation',
            label: 'pulse',
            startTime: 1,
            duration: 0.5,
            repetitions: 1,
            targets: [{ targetId: 'tl1', mode: 'scale', scaleFactor: 1.2 }],
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const act = result.response.actions[0]!;
    if (act.action !== 'CREATE' || act.item.kind !== 'blink_animation') {
      throw new Error('expected blink_animation CREATE');
    }
    expect(act.item.targets[0]!.mode).toBe('scale');
    expect(act.item.repetitions).toBe(1);
  });

  it('does not auto-link axesId when multiple axes are being created', () => {
    const map = new Map<string, SceneItem>();
    const resp = {
      reply: 'update scene',
      actions: [
        { action: 'CREATE', item: { id: 'ax_a', kind: 'axes' } },
        { action: 'CREATE', item: { id: 'ax_b', kind: 'axes' } },
        {
          action: 'CREATE',
          item: { id: 'p1', kind: 'graphPlot', fn: { jsExpr: 'x', pyExpr: 'x' } },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('axesId is required'))).toBe(true);
    }
  });

  it('normalizes polyline CREATE with ordered points and arrow flags', () => {
    const map = new Map<string, SceneItem>();
    const resp = {
      reply: 'polyline',
      actions: [
        {
          action: 'CREATE',
          item: {
            id: 'pl1',
            kind: 'shape',
            label: 'Poly',
            shapeType: 'polyline',
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 2 },
            ],
            tailArrow: true,
            headArrow: false,
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const act = result.response.actions[0]!;
    if (act.action !== 'CREATE' || act.item.kind !== 'shape') {
      throw new Error('expected shape CREATE');
    }
    expect(act.item.shapeType).toBe('polyline');
    expect(act.item.points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 2 },
    ]);
    expect(act.item.tailArrow).toBe(true);
    expect(act.item.headArrow).toBe(false);
  });

  it('defaults sparse polyline points and missing arrow flags', () => {
    const map = new Map<string, SceneItem>();
    const resp = {
      reply: 'bad points',
      actions: [
        {
          action: 'CREATE',
          item: {
            id: 'pl2',
            kind: 'shape',
            label: 'P2',
            shapeType: 'polyline',
            points: [{ x: 0, y: 0 }],
          },
        },
      ],
    };
    const result = validateAgentResponse(resp, map);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const act = result.response.actions[0]!;
    if (act.action !== 'CREATE' || act.item.kind !== 'shape') {
      throw new Error('expected shape CREATE');
    }
    expect(act.item.points.length).toBeGreaterThanOrEqual(2);
    expect(act.item.tailArrow).toBe(false);
    expect(act.item.headArrow).toBe(false);
  });
});

describe('expression pair normalization', () => {
  it('repairs ^ and derives the missing dialect on graphCurve CREATE', () => {
    const map = new Map<string, SceneItem>();
    map.set('ax1', axes('ax1'));
    const result = validateAgentResponse(
      {
        reply: 'add curve',
        actions: [
          {
            action: 'CREATE',
            item: {
              id: 'c1',
              kind: 'graphCurve',
              axesId: 'ax1',
              curve: {
                jsXExpr: 't^2',
                jsYExpr: 'Math.sin(t)',
                pyYExpr: 'np.sin(t)',
              },
              tDomain: [0, 6.28],
            },
          },
        ],
      },
      map,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const act = result.response.actions[0]!;
    if (act.action !== 'CREATE' || act.item.kind !== 'graphCurve') {
      throw new Error('expected graphCurve CREATE');
    }
    expect(act.item.curve.jsXExpr).toBe('t**2');
    expect(act.item.curve.pyXExpr).toBe('t**2');
    expect(act.item.curve.jsYExpr).toBe('Math.sin(t)');
    expect(act.item.curve.pyYExpr).toBe('np.sin(t)');
  });

  it('rejects graphCurve CREATE with a coordinate missing both dialects', () => {
    const map = new Map<string, SceneItem>();
    map.set('ax1', axes('ax1'));
    const result = validateAgentResponse(
      {
        reply: 'bad curve',
        actions: [
          {
            action: 'CREATE',
            item: {
              id: 'c1',
              kind: 'graphCurve',
              axesId: 'ax1',
              curve: { jsXExpr: 't', pyXExpr: 't' },
              tDomain: [0, 1],
            },
          },
        ],
      },
      map,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /y\(t\)/.test(e))).toBe(true);
    }
  });

  it('repairs ^ and derives the missing dialect on graphPointSequence CREATE', () => {
    const map = new Map<string, SceneItem>();
    map.set('ax1', axes('ax1'));
    const result = validateAgentResponse(
      {
        reply: 'add sequence',
        actions: [
          {
            action: 'CREATE',
            item: {
              id: 'ps1',
              kind: 'graphPointSequence',
              axesId: 'ax1',
              jsXExpr: 'n',
              pyXExpr: 'n',
              jsYExpr: 'n^2',
              nMin: 1,
              nMax: 5,
            },
          },
        ],
      },
      map,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const act = result.response.actions[0]!;
    if (act.action !== 'CREATE' || act.item.kind !== 'graphPointSequence') {
      throw new Error('expected graphPointSequence CREATE');
    }
    expect(act.item.jsYExpr).toBe('n**2');
    expect(act.item.pyYExpr).toBe('n**2');
  });

  it('repairs ^ and derives the missing dialect on target_animation parametricPath CREATE', () => {
    const map = new Map<string, SceneItem>();
    map.set('tl1', textLine('tl1'));
    const result = validateAgentResponse(
      {
        reply: 'move along path',
        actions: [
          {
            action: 'CREATE',
            item: {
              id: 'ta1',
              kind: 'target_animation',
              label: 'path move',
              mode: 'path',
              startTime: 1,
              duration: 1.5,
              targets: [
                {
                  targetId: 'tl1',
                  pathKind: 'parametric',
                  parametricPath: {
                    jsXExpr: 't^2',
                    jsYExpr: 'Math.sin(t)',
                    pyYExpr: 'np.sin(t)',
                    tMin: 0,
                    tMax: 6.28,
                  },
                },
              ],
            },
          },
        ],
      },
      map,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const act = result.response.actions[0]!;
    if (act.action !== 'CREATE' || act.item.kind !== 'target_animation') {
      throw new Error('expected target_animation CREATE');
    }
    const pp = act.item.targets[0]!.parametricPath!;
    expect(pp.jsXExpr).toBe('t**2');
    expect(pp.pyXExpr).toBe('t**2');
    expect(pp.jsYExpr).toBe('Math.sin(t)');
    expect(pp.pyYExpr).toBe('np.sin(t)');
  });

  it('keeps 0 defaults for wholly missing TA parametric axes', () => {
    const map = new Map<string, SceneItem>();
    map.set('tl1', textLine('tl1'));
    const result = validateAgentResponse(
      {
        reply: 'path with defaults',
        actions: [
          {
            action: 'CREATE',
            item: {
              id: 'ta1',
              kind: 'target_animation',
              label: 'path',
              mode: 'path',
              startTime: 1,
              duration: 1,
              targets: [
                {
                  targetId: 'tl1',
                  pathKind: 'parametric',
                  parametricPath: { tMin: 0, tMax: 1 },
                },
              ],
            },
          },
        ],
      },
      map,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const act = result.response.actions[0]!;
    if (act.action !== 'CREATE' || act.item.kind !== 'target_animation') {
      throw new Error('expected target_animation CREATE');
    }
    const pp = act.item.targets[0]!.parametricPath!;
    expect(pp.jsXExpr).toBe('0');
    expect(pp.pyXExpr).toBe('0');
    expect(pp.jsYExpr).toBe('0');
    expect(pp.pyYExpr).toBe('0');
  });
});

describe('expression pair UPDATE normalization', () => {
  it('repairs graphPlot fn UPDATE without dropping sibling fields', () => {
    const map = new Map<string, SceneItem>();
    map.set('ax1', axes('ax1'));
    map.set('p1', {
      id: 'p1',
      kind: 'graphPlot',
      label: 'plot',
      layer: 0,
      startTime: 0,
      duration: 2,
      x: 0,
      y: 0,
      scale: 1,
      posSteps: [{ kind: 'absolute' }],
      audioTrackId: null,
      axesId: 'ax1',
      fn: { id: 'p1_fn', jsExpr: 'x', pyExpr: 'x', color: '#3b82f6', label: '' },
      xDomain: null,
      strokeWidth: 2,
    });
    const result = validateAgentResponse(
      {
        reply: 'square it',
        actions: [
          {
            action: 'UPDATE',
            itemId: 'p1',
            updates: { fn: { jsExpr: 'x^2', color: '#ff0000' } },
          },
        ],
      },
      map,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const act = result.response.actions[0]!;
    if (act.action !== 'UPDATE') throw new Error('expected UPDATE');
    const fn = (act.updates as Record<string, unknown>).fn as Record<
      string,
      unknown
    >;
    expect(fn.jsExpr).toBe('x**2');
    expect(fn.pyExpr).toBe('x**2');
    expect(fn.color).toBe('#ff0000');
  });

  it('repairs graphCurve UPDATE without dropping sibling curve fields', () => {
    const map = new Map<string, SceneItem>();
    map.set('ax1', axes('ax1'));
    map.set('c1', {
      id: 'c1',
      kind: 'graphCurve',
      label: 'curve',
      layer: 0,
      startTime: 0,
      duration: 2,
      x: 0,
      y: 0,
      scale: 1,
      posSteps: [{ kind: 'absolute' }],
      audioTrackId: null,
      axesId: 'ax1',
      curve: {
        id: 'c1_curve',
        jsXExpr: 't',
        jsYExpr: 't',
        pyXExpr: 't',
        pyYExpr: 't',
        color: '#3b82f6',
        label: '',
      },
      tDomain: [0, 6.28],
      strokeWidth: 2,
    });
    const result = validateAgentResponse(
      {
        reply: 'retarget x',
        actions: [
          {
            action: 'UPDATE',
            itemId: 'c1',
            updates: { curve: { jsXExpr: 't^2', color: '#ff0000' } },
          },
        ],
      },
      map,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const act = result.response.actions[0]!;
    if (act.action !== 'UPDATE') throw new Error('expected UPDATE');
    const updates = act.updates as Record<string, unknown>;
    const curve = updates.curve as Record<string, unknown>;
    expect(curve.jsXExpr).toBe('t**2');
    expect(curve.pyXExpr).toBe('t**2');
    expect(curve.color).toBe('#ff0000');
  });

  it('folds top-level coordinate aliases into curve on UPDATE', () => {
    const map = new Map<string, SceneItem>();
    map.set('ax1', axes('ax1'));
    map.set('c1', {
      id: 'c1',
      kind: 'graphCurve',
      label: 'curve',
      layer: 0,
      startTime: 0,
      duration: 2,
      x: 0,
      y: 0,
      scale: 1,
      posSteps: [{ kind: 'absolute' }],
      audioTrackId: null,
      axesId: 'ax1',
      curve: {
        id: 'c1_curve',
        jsXExpr: 't',
        jsYExpr: 't',
        pyXExpr: 't',
        pyYExpr: 't',
        color: '#3b82f6',
        label: '',
      },
      tDomain: [0, 6.28],
      strokeWidth: 2,
    });
    const result = validateAgentResponse(
      {
        reply: 'retarget x',
        actions: [
          {
            action: 'UPDATE',
            itemId: 'c1',
            updates: { jsXExpr: 't^2' },
          },
        ],
      },
      map,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const act = result.response.actions[0]!;
    if (act.action !== 'UPDATE') throw new Error('expected UPDATE');
    const updates = act.updates as Record<string, unknown>;
    const curve = updates.curve as Record<string, unknown>;
    expect(curve.jsXExpr).toBe('t**2');
    expect(curve.pyXExpr).toBe('t**2');
    expect('jsXExpr' in updates).toBe(false);
  });

  it('repairs target_animation parametricPath UPDATE preserving sibling row fields', () => {
    const map = new Map<string, SceneItem>();
    map.set('tl1', textLine('tl1'));
    map.set('ta1', {
      id: 'ta1',
      kind: 'target_animation',
      label: 'path',
      layer: 0,
      startTime: 1,
      duration: 1.5,
      mode: 'path',
      targets: [
        {
          targetId: 'tl1',
          pathKind: 'parametric',
          parametricPath: {
            jsXExpr: 't',
            jsYExpr: 't',
            pyXExpr: 't',
            pyYExpr: 't',
            tMin: 0,
            tMax: 6.28,
          },
        },
      ],
    });
    const result = validateAgentResponse(
      {
        reply: 'steepen path',
        actions: [
          {
            action: 'UPDATE',
            itemId: 'ta1',
            updates: {
              targets: [
                {
                  targetId: 'tl1',
                  pathKind: 'parametric',
                  parametricPath: { jsXExpr: 't^2' },
                },
              ],
            },
          },
        ],
      },
      map,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const act = result.response.actions[0]!;
    if (act.action !== 'UPDATE') throw new Error('expected UPDATE');
    const targets = (act.updates as Record<string, unknown>).targets as Record<
      string,
      unknown
    >[];
    const pp = (targets[0]! as Record<string, unknown>)
      .parametricPath as Record<string, unknown>;
    expect(pp.jsXExpr).toBe('t**2');
    expect(pp.pyXExpr).toBe('t**2');
    // Untouched axes stay absent here; commit deep-merges the row over the
    // stored one so the y(t) pair survives (covered in commit.test.ts).
    expect('jsYExpr' in pp).toBe(false);
    expect(targets[0]!.pathKind).toBe('parametric');
  });

  it('repairs graphPointSequence axis UPDATE', () => {
    const map = new Map<string, SceneItem>();
    map.set('ax1', axes('ax1'));
    map.set('ps1', {
      id: 'ps1',
      kind: 'graphPointSequence',
      label: 'seq',
      layer: 0,
      startTime: 0,
      duration: 5,
      x: 0,
      y: 0,
      scale: 1,
      posSteps: [{ kind: 'absolute' }],
      audioTrackId: null,
      axesId: 'ax1',
      jsXExpr: 'n',
      jsYExpr: '0',
      pyXExpr: 'n',
      pyYExpr: '0',
      nMin: 1,
      nMax: 5,
      mode: 'accumulation',
      defaults: {
        color: '#3b82f6',
        pointRadius: 0.08,
        animDuration: 1,
        waitAfter: 0.3,
      },
      perN: {},
    });
    const result = validateAgentResponse(
      {
        reply: 'parabola',
        actions: [
          {
            action: 'UPDATE',
            itemId: 'ps1',
            updates: { jsYExpr: 'n^2' },
          },
        ],
      },
      map,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const act = result.response.actions[0]!;
    if (act.action !== 'UPDATE') throw new Error('expected UPDATE');
    const updates = act.updates as Record<string, unknown>;
    expect(updates.jsYExpr).toBe('n**2');
    expect(updates.pyYExpr).toBe('n**2');
    expect(updates.jsXExpr).toBeUndefined();
  });
});

describe('allowed kind boundary', () => {
  it('rejects graphArea CREATE', () => {
    const map = new Map<string, SceneItem>();
    const result = validateAgentResponse(
      {
        reply: 'add area',
        actions: [
          { action: 'CREATE', item: { id: 'a1', kind: 'graphArea' } },
        ],
      },
      map,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects graphField CREATE', () => {
    const map = new Map<string, SceneItem>();
    const result = validateAgentResponse(
      {
        reply: 'add field',
        actions: [
          { action: 'CREATE', item: { id: 'f1', kind: 'graphField' } },
        ],
      },
      map,
    );
    expect(result.ok).toBe(false);
  });
});

describe('frameId validation', () => {
  const frameCtx = {
    frameIds: ['f1', 'f2'],
    activeFrameId: 'f2',
    startFrameId: 'f1',
  };

  it('stamps the active frame onto drawable CREATEs missing frameId', () => {
    const map = new Map<string, SceneItem>();
    const result = validateAgentResponse(
      {
        reply: 'add a line',
        actions: [
          {
            action: 'CREATE',
            item: {
              id: 'tl9',
              kind: 'textLine',
              label: 'Title',
              raw: 'hello $x$',
              font: 'Alef',
              startTime: 0,
              duration: 2,
            },
          },
        ],
      },
      map,
      frameCtx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const act = result.response.actions[0]!;
    if (act.action !== 'CREATE' || act.item.kind !== 'textLine') {
      throw new Error('expected textLine CREATE');
    }
    expect(act.item.frameId).toBe('f2');
  });

  it('keeps an explicit valid frameId on CREATE', () => {
    const map = new Map<string, SceneItem>();
    const result = validateAgentResponse(
      {
        reply: 'add axes to frame 1',
        actions: [
          {
            action: 'CREATE',
            item: {
              id: 'ax9',
              kind: 'axes',
              label: 'Axes',
              frameId: 'f1',
              xRange: [0, 10, 1],
              yRange: [0, 10, 1],
            },
          },
        ],
      },
      map,
      frameCtx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const act = result.response.actions[0]!;
    if (act.action !== 'CREATE' || act.item.kind !== 'axes') {
      throw new Error('expected axes CREATE');
    }
    expect(act.item.frameId).toBe('f1');
  });

  it('rejects CREATE with an unknown frameId', () => {
    const map = new Map<string, SceneItem>();
    const result = validateAgentResponse(
      {
        reply: 'bad frame',
        actions: [
          {
            action: 'CREATE',
            item: {
              id: 'tl9',
              kind: 'textLine',
              label: 'Title',
              raw: 'hello',
              frameId: 'nope',
            },
          },
        ],
      },
      map,
      frameCtx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /frameId "nope"/.test(e))).toBe(true);
    }
  });

  it('rejects UPDATE that sets an unknown frameId', () => {
    const map = new Map<string, SceneItem>();
    map.set('tl1', textLine('tl1'));
    const result = validateAgentResponse(
      {
        reply: 'move frame',
        actions: [
          { action: 'UPDATE', itemId: 'tl1', updates: { frameId: 'nope' } },
        ],
      },
      map,
      frameCtx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /frameId "nope"/.test(e))).toBe(true);
    }
  });

  it('drops frameId on exit_animation CREATE instead of failing', () => {
    const map = new Map<string, SceneItem>();
    map.set('tl1', textLine('tl1'));
    const result = validateAgentResponse(
      {
        reply: 'exit with stray frame',
        actions: [
          {
            action: 'CREATE',
            item: {
              id: 'ex9',
              kind: 'exit_animation',
              label: 'Exit',
              startTime: 4,
              duration: 1,
              frameId: 'f1',
              targets: [{ targetId: 'tl1', animStyle: 'fade_out' }],
            },
          },
        ],
      },
      map,
      frameCtx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const act = result.response.actions[0]!;
    if (act.action !== 'CREATE' || act.item.kind !== 'exit_animation') {
      throw new Error('expected exit_animation CREATE');
    }
    expect('frameId' in act.item).toBe(false);
  });

  it('accepts blink_animation CREATE without frameId', () => {
    const map = new Map<string, SceneItem>();
    map.set('tl1', textLine('tl1'));
    const result = validateAgentResponse(
      {
        reply: 'blink',
        actions: [
          {
            action: 'CREATE',
            item: {
              id: 'bl9',
              kind: 'blink_animation',
              label: 'Blink',
              startTime: 1,
              duration: 0.5,
              repetitions: 1,
              targets: [{ targetId: 'tl1', mode: 'scale' }],
            },
          },
        ],
      },
      map,
      frameCtx,
    );
    expect(result.ok).toBe(true);
  });
});
