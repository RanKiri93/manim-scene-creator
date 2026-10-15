import { describe, expect, it } from 'vitest';
import { createAxes, createShape, defaultSceneDefaults } from '@/store/factories';
import type { FrameDef, ItemId, SceneItem } from '@/types/scene';
import { DraftSession } from './draft';
import { runAgentLoop } from './runAgentLoop';
import type { LoopConversation, LoopStep, LoopToolCall, LoopToolResult } from './types';

const frames: FrameDef[] = [{ id: 'home', col: 0, row: 0 }];

function session(items: SceneItem[] = []) {
  const axes = createAxes(defaultSceneDefaults());
  axes.id = 'ax1';
  axes.xRange = [0, 1, 0.5];
  axes.yRange = [0, 2, 1];
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

/** Plays back fixed model turns and records what the loop sent back. */
class ScriptedConversation implements LoopConversation {
  readonly received: LoopToolResult[][] = [];
  private turn = 0;
  private readonly turns: ((received: LoopToolResult[][]) => LoopStep)[];
  constructor(turns: ((received: LoopToolResult[][]) => LoopStep)[]) {
    this.turns = turns;
  }
  async next(): Promise<LoopStep> {
    const t = this.turns[Math.min(this.turn, this.turns.length - 1)]!;
    this.turn += 1;
    return t(this.received);
  }
  pushToolResults(results: LoopToolResult[]): void {
    this.received.push(results);
  }
}

const call = (name: string, input: unknown, id = `${name}-${Math.random().toString(36).slice(2, 6)}`): LoopToolCall => ({ id, name, input });
const step = (...toolCalls: LoopToolCall[]): LoopStep => ({ text: '', toolCalls });

const plot = { action: 'CREATE', item: { id: 'p1', kind: 'graphPlot', axesId: 'ax1', label: 'f', fn: { jsExpr: 'x*x + 1', pyExpr: 'x**2 + 1' }, xDomain: [0, 1] } };
const dot = { action: 'CREATE', item: { id: 'd1', kind: 'graphDot', axesId: 'ax1', label: 'P', startTime: 1, duration: 0.5, dot: { attachment: { kind: 'function', graphPlotId: 'p1', x: 0 } } } };
const follow = (targetX: number) => ({ action: 'CREATE', item: { id: 'm1', kind: 'target_animation', label: 'move', mode: 'graphFollow', startTime: 2, duration: 2, targets: [{ targetId: 'd1', targetX, easing: 'linear' }] } });
const drop = { action: 'CREATE', item: { id: 's1', kind: 'shape', shapeType: 'line', label: 'drop', startTime: 1, endpoints: { start: { kind: 'graphDot', dotId: 'd1' }, end: { kind: 'graphDotFoot', dotId: 'd1', axis: 'x' } } } };

describe('agent loop', () => {
  it('returns validation errors to the model, which fixes them, inspects and finishes', async () => {
    const s = session();
    const conversation = new ScriptedConversation([
      () => step(call('propose_changes', { actions: [plot, dot, follow(3), drop] })),
      () => step(call('propose_changes', { actions: [plot, dot, follow(1), drop] })),
      () => step(call('inspect_scene', { times: [2, 3, 4], itemIds: ['d1', 's1'] }), call('check_export', {})),
      () => step(call('finish', { reply: 'Added the plot, the moving point and its drop line.' })),
    ]);
    const outcome = await runAgentLoop({ conversation, session: s });
    expect(outcome.stoppedEarly).toBe(false);
    expect(outcome.reply).toMatch(/drop line/);
    expect(outcome.actions.map((a) => (a.action === 'CREATE' ? a.item.id : ''))).toEqual(['p1', 'd1', 'm1', 's1']);

    const [first, second, third] = conversation.received;
    expect(first![0]!.isError).toBe(true);
    expect(first![0]!.text).toMatch(/leaves plot source domain/);
    expect(JSON.parse(second![0]!.text)).toMatchObject({ draftActions: 4 });

    const inspect = JSON.parse(third![0]!.text);
    const dotFacts = inspect.items.find((it: { id: string }) => it.id === 'd1');
    expect(dotFacts.at.map((row: { graph: number[] }) => row.graph)).toEqual([[0, 1], [0.5, 1.25], [1, 2]]);
    const lineFacts = inspect.items.find((it: { id: string }) => it.id === 's1');
    const endAt4 = lineFacts.at[2];
    expect(endAt4.start[0]).toBeCloseTo(endAt4.end[0]);
    expect(endAt4.length).toBeCloseTo(2); // y from 2 down to 0 with unit y scale
    expect(inspect.sceneDurationSec).toBeGreaterThanOrEqual(4);
    expect(JSON.parse(third![1]!.text)).toMatchObject({ ok: true });

    expect(outcome.log.map((l) => l.tool)).toEqual(['propose_changes', 'propose_changes', 'inspect_scene', 'check_export', 'finish']);
    expect(outcome.log[0]!.isError).toBe(true);
  });

  it('keeps the draft unchanged when a later proposal fails, and resets on request', async () => {
    const s = session();
    const conversation = new ScriptedConversation([
      () => step(call('propose_changes', { actions: [plot] })),
      () => step(call('propose_changes', { actions: [{ action: 'CREATE', item: { id: 'p1', kind: 'graphPlot', axesId: 'ax1', fn: { jsExpr: 'x', pyExpr: 'x' } } }] })),
      (received) => {
        expect(received[1]![0]!.text).toMatch(/draft already holds 1 action/);
        return step(call('reset_draft', {}));
      },
      () => ({ text: 'Nothing to do after all.', toolCalls: [] }),
    ]);
    const outcome = await runAgentLoop({ conversation, session: s });
    expect(outcome.actions).toEqual([]);
    expect(outcome.reply).toBe('Nothing to do after all.');
  });

  it('stops at the step limit and says so', async () => {
    const conversation = new ScriptedConversation([() => step(call('inspect_scene', {}))]);
    const outcome = await runAgentLoop({ conversation, session: session(), maxSteps: 3 });
    expect(outcome.stoppedEarly).toBe(true);
    expect(outcome.reply).toMatch(/stopped after 3 steps/);
    expect(conversation.received).toHaveLength(3);
  });

  it('reports export errors from check_export', async () => {
    const broken = createShape(0);
    broken.id = 'broken';
    broken.shapeType = 'line';
    broken.endpoints = { start: { kind: 'graphDot', dotId: 'gone' }, end: { kind: 'point', x: 0, y: 0 } };
    const conversation = new ScriptedConversation([
      () => step(call('check_export', {})),
      () => step(call('finish', { reply: 'done' })),
    ]);
    await runAgentLoop({ conversation, session: session([broken]) });
    const exportResult = conversation.received[0]![0]!;
    expect(exportResult.isError).toBe(true);
    expect(exportResult.text).toMatch(/Connector/);
  });
});
