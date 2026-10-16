import { beforeEach, describe, expect, it } from 'vitest';
import { createShape, defaultSceneDefaults } from '@/store/factories';
import { useSceneStore } from '@/store/useSceneStore';
import type { AudioTrackItem, FrameDef, ItemId, SceneItem } from '@/types/scene';
import { AGENT_CHAT_RESPONSE_JSON_SCHEMA } from '../types';
import { GEMINI_RESPONSE_SCHEMA } from '../providers/gemini';
import { buildSystemPrompt } from '../systemPrompt';
import { buildPreviewState } from '../previewSelectors';
import { commitActions } from '../commit';
import { describeTimelineEdit } from '../timelineEdits';
import { validateAgentResponse } from '../validate';
import { DraftSession } from './draft';
import { runLoopTool } from './tools';

const frames: FrameDef[] = [{ id: 'home', col: 0, row: 0 }];

function clip(id: string, startTime: number, duration: number): SceneItem {
  const s = createShape();
  return { ...s, id, label: id, startTime, duration } as SceneItem;
}
const voice = (startTime: number): AudioTrackItem => ({
  id: 'voice', text: 'עכשיו הנקודה זזה', audioUrl: '', startTime, duration: 1.5,
  boundaries: [{ word: 'עכשיו', start: 0, end: 0.4 }, { word: 'הנקודה', start: 0.5, end: 0.9 }, { word: 'זזה', start: 1, end: 1.4 }],
});

/** graph 0–2 s, dot 3–4 s, move 5–7 s, narration at 8 s. */
function scene() {
  return new Map<ItemId, SceneItem>([clip('graph', 0, 2), clip('dot', 3, 1), clip('move', 5, 2)].map((c) => [c.id, c]));
}
function session(audioItems: AudioTrackItem[] = [voice(8)]) {
  return new DraftSession({ items: scene(), frames, startFrameId: 'home', activeFrameId: 'home', defaults: defaultSceneDefaults(), audioItems, currentTimeSec: 0 });
}
const T = (edit: Record<string, unknown>) => ({ action: 'TIMELINE', edit });
const starts = (s: DraftSession) => Object.fromEntries([...s.scene().values()].map((it) => [it.id, it.startTime]));

describe('Retime and make room (R16)', () => {
  it('slows a range by 25% and inserts a pause, moving the narration along', async () => {
    const s = session();
    // Scale first: dot 3 → 2 + 1·1.25 = 3.25, move 5 → 2 + 3·1.25 = 5.75; then the pause goes at
    // the move's new start, which pushes it to 7.75.
    const r = s.propose([T({ op: 'scale', from: 2, to: 8, factor: 1.25 }), T({ op: 'insert', at: 5.75, seconds: 2 })]);
    expect(r).toMatchObject({ ok: true });
    expect(starts(s)).toEqual({ graph: 0, dot: 3.25, move: 7.75 });
    expect(s.scene().get('move')).toMatchObject({ duration: 2.5 });
    // Narration at 8 → 8 + 6·0.25 = 9.5, then + 2 = 11.5.
    expect(s.audio()[0]!.startTime).toBe(11.5);
    const words = JSON.parse((await runLoopTool({ id: 'f', name: 'find_words', input: { text: 'זזה' } }, s, {})).result.text);
    expect(words.matches[0].start).toBe(12.5);
  });

  it('applies in order: a clip created after the edit keeps its time, one created before moves', () => {
    const s = session([]);
    const exit = (id: string, startTime: number) => ({ action: 'CREATE', item: { id, kind: 'exit_animation', label: id, startTime, duration: 1, targets: [{ targetId: 'graph', animStyle: 'fade_out' }] } });
    expect(s.propose([exit('before', 4), T({ op: 'insert', at: 2.5, seconds: 3 }), exit('after', 4)])).toMatchObject({ ok: true });
    expect(starts(s)).toMatchObject({ dot: 6, move: 8, before: 7, after: 4 });
  });

  it('refuses edits the editor would refuse, naming what is in the way', () => {
    const s = session();
    const inside = s.propose([T({ op: 'insert', at: 1, seconds: 2 })]);
    expect(inside.ok).toBe(false);
    if (!inside.ok) expect(inside.errors.join(' ')).toMatch(/TIMELINE insert 2s at 1s: A clip spans the insertion point.*clip "graph" \(graph\) 0s–2s/);
    const speech = s.propose([T({ op: 'scale', from: 7, to: 10, factor: 2 })]);
    expect(speech.ok).toBe(false);
    if (!speech.ok) expect(speech.errors.join(' ')).toMatch(/Narration plays inside the range.*narration ".*" \(voice\) 8s–9.5s/);
    const bad = s.propose([T({ op: 'stretch', from: 1, to: 2 })]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(' ')).toMatch(/op must be "insert", "remove" or "scale"/);
  });

  it('single replies validate TIMELINE against the narration too', () => {
    const r = validateAgentResponse({ reply: 'ok', actions: [T({ op: 'scale', from: 7, to: 10, factor: 2 })] }, scene(), undefined, { audioItems: [voice(8)] });
    expect(r.ok).toBe(false);
    expect(validateAgentResponse({ reply: 'ok', actions: [T({ op: 'remove', from: 2, to: 3 })] }, scene()).ok).toBe(true);
  });

  it('the approve preview moves clips and marks them changed', () => {
    const preview = buildPreviewState(scene(), [{ action: 'TIMELINE', edit: { op: 'remove', from: 2, to: 3 } }]);
    expect(preview.mergedItems.get('dot')!.startTime).toBe(2);
    expect([...preview.ops.keys()].sort()).toEqual(['dot', 'move']);
  });

  it('describes edits for the log and the proposal list', () => {
    expect(describeTimelineEdit({ op: 'scale', from: 2, to: 8, factor: 1.25 })).toBe('scale 2s–8s ×1.25 (25% slower)');
    expect(describeTimelineEdit({ op: 'scale', from: 0, to: 1, factor: 0.8 })).toBe('scale 0s–1s ×0.8 (20% faster)');
    expect(describeTimelineEdit({ op: 'remove', from: 2, to: 3.5 })).toBe('remove 2s–3.5s');
  });
});

describe('Approve applies a TIMELINE action through the store', () => {
  beforeEach(() => {
    useSceneStore.setState((s) => {
      s.items.clear();
      s.audioItems = [];
      s.currentTime = 0;
    });
  });

  it('inserts time in the live scene, moving narration', () => {
    useSceneStore.setState((s) => {
      for (const [id, item] of scene()) s.items.set(id, item);
      s.audioItems = [voice(8)];
    });
    commitActions([{ action: 'TIMELINE', edit: { op: 'insert', at: 4.5, seconds: 2 } }]);
    const st = useSceneStore.getState();
    expect(st.items.get('move')!.startTime).toBe(7);
    expect(st.items.get('dot')!.startTime).toBe(3);
    expect(st.audioItems[0]!.startTime).toBe(10);
  });
});

describe('schemas and prompt', () => {
  it('declares the TIMELINE action in both schemas', () => {
    const anyOf = AGENT_CHAT_RESPONSE_JSON_SCHEMA.properties.actions.items.anyOf as unknown as { properties: Record<string, { enum?: string[]; properties?: Record<string, unknown> }> }[];
    expect(anyOf[3]!.properties.action!.enum).toEqual(['TIMELINE']);
    expect(anyOf[3]!.properties.edit!.properties).toHaveProperty('factor');
    const gemini = GEMINI_RESPONSE_SCHEMA.properties.actions.items.properties;
    expect(gemini.action.enum).toContain('TIMELINE');
    expect(gemini.edit.properties.op.enum).toEqual(['insert', 'remove', 'scale']);
  });

  it('teaches timeline edits in both modes', () => {
    for (const prompt of [buildSystemPrompt(''), buildSystemPrompt('', 'loop')]) {
      expect(prompt).toContain('14. Timeline edits');
      expect(prompt).toContain('R16. Retime and make room');
      expect(prompt).toContain('only TIMELINE edits (rule 14) move them');
    }
  });
});
