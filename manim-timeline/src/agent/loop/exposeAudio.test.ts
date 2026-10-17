import { beforeEach, describe, expect, it } from 'vitest';
import { createShape, defaultSceneDefaults } from '@/store/factories';
import { useSceneStore } from '@/store/useSceneStore';
import type { AudioTrackItem, FrameDef, ItemId, SceneItem } from '@/types/scene';
import { buildPreviewState } from '../previewSelectors';
import { commitActions } from '../commit';
import { describeAudioEdit } from '../audioEdits';
import { validateAgentResponse } from '../validate';
import { DraftSession } from './draft';
import { runLoopTool } from './tools';

const frames: FrameDef[] = [{ id: 'home', col: 0, row: 0 }];

function clip(id: string, startTime: number, duration: number): SceneItem {
  return { ...createShape(), id, label: id, startTime, duration } as SceneItem;
}

/** Narration at 2 s: "נגדיר אה אה את הפונקציה" with an "um" and a 2 s pause before the last word. */
const voice = (): AudioTrackItem => ({
  id: 'voice',
  text: 'נגדיר אה את הפונקציה',
  audioUrl: '',
  startTime: 2,
  duration: 4.8,
  boundaries: [
    { word: 'נגדיר', start: 0, end: 0.5 },
    { word: 'אה', start: 0.9, end: 1.1 },
    { word: 'את', start: 1.5, end: 1.7 },
    { word: 'הפונקציה', start: 3.7, end: 4.5 },
  ],
});

/** "box" shows when "הפונקציה" is said (5.7 s); "title" is at 0. */
const scene = () => new Map<ItemId, SceneItem>([clip('title', 0, 1), clip('box', 5.7, 1)].map((c) => [c.id, c]));
const session = () =>
  new DraftSession({ items: scene(), frames, startFrameId: 'home', activeFrameId: 'home', defaults: defaultSceneDefaults(), audioItems: [voice()], currentTimeSec: 0 });
const A = (edit: Record<string, unknown>) => ({ action: 'AUDIO', edit });
const report = async (s: DraftSession) => JSON.parse((await runLoopTool({ id: 'r', name: 'audio_report', input: {} }, s, {})).result.text);

describe('Narration cleanup in the tool loop (R24)', () => {
  it('audio_report lists the pause and the filler with ready cuts', async () => {
    const r = await report(session());
    expect(r.pauses).toEqual([{ trackId: 'voice', seconds: 2, from: 3.95, to: 5.45, after: 'את', before: 'הפונקציה' }]);
    expect(r.fillers).toEqual([{ trackId: 'voice', text: 'אה', at: 2.9, from: 2.7, to: 3.3 }]);
  });

  it('anchors a clip to its word, then cuts (last to first): the anchored clip follows', async () => {
    const s = session();
    const r = s.propose([A({ op: 'anchor', itemId: 'box', at: 5.7 }), A({ op: 'cut', from: 3.95, to: 5.45 }), A({ op: 'cut', from: 2.7, to: 3.3 })]);
    expect(r).toMatchObject({ ok: true });
    expect(s.scene().get('box')!.startTime).toBeCloseTo(3.6); // 5.7 − 1.5 − 0.6
    expect(s.scene().get('title')!.startTime).toBe(0);
    const after = await report(s);
    expect(after.pauses).toEqual([]);
    expect(after.fillers).toEqual([]);
    const found = JSON.parse((await runLoopTool({ id: 'f', name: 'find_words', input: { text: 'הפונקציה' } }, s, {})).result.text);
    expect(found.matches[0].start).toBeCloseTo(3.6);
  });

  it('refuses cuts across a clip edge, unknown tracks and anchors with no word there', () => {
    const s = session();
    const edge = s.propose([A({ op: 'cut', from: 1, to: 3 })]);
    expect(edge.ok).toBe(false);
    if (!edge.ok) expect(edge.errors.join(' ')).toMatch(/AUDIO cut narration 1s–3s: the range crosses a narration clip edge.*\(voice\) 2s–6.8s/);
    const gain = s.propose([A({ op: 'gain', trackId: 'nope', gainDb: 3 })]);
    expect(gain.ok).toBe(false);
    const anchor = s.propose([A({ op: 'anchor', itemId: 'box', at: 6.5 })]);
    expect(anchor.ok).toBe(false);
    if (!anchor.ok) expect(anchor.errors.join(' ')).toMatch(/no word starts at 6.5s/);
    const missing = validateAgentResponse({ reply: 'x', actions: [A({ op: 'anchor', itemId: 'ghost', at: 2 })] }, scene(), undefined, { audioItems: [voice()] });
    expect(missing.ok).toBe(false);
  });

  it('describes edits and previews an anchor move', () => {
    expect(describeAudioEdit({ op: 'cut', from: 3.95, to: 5.45 })).toBe('cut narration 3.95s–5.45s');
    useSceneStore.setState((s) => {
      s.audioItems = [voice()];
    });
    const preview = buildPreviewState(new Map([['box', clip('box', 1, 1)]]), [{ action: 'AUDIO', edit: { op: 'anchor', itemId: 'box', at: 5.7 } }]);
    expect(preview.mergedItems.get('box')!.startTime).toBe(5.7);
    expect(preview.ops.get('box')).toBe('update');
  });
});

describe('Approve applies AUDIO actions through the store', () => {
  beforeEach(() => {
    useSceneStore.setState((s) => {
      s.items = scene();
      s.audioItems = [voice()];
      s.currentTime = 0;
    });
  });

  it('anchors, cuts and sets gain in one undo step', () => {
    const pastBefore = useSceneStore.temporal.getState().pastStates.length;
    commitActions([
      { action: 'AUDIO', edit: { op: 'anchor', itemId: 'box', at: 5.7 } },
      { action: 'AUDIO', edit: { op: 'cut', from: 3.95, to: 5.45 } },
      { action: 'AUDIO', edit: { op: 'gain', trackId: 'voice', gainDb: -2 } },
    ]);
    const st = useSceneStore.getState();
    expect(st.items.get('box')!.startTime).toBeCloseTo(4.2);
    expect(st.items.get('box')!.wordAnchor).toBeDefined();
    expect(st.audioItems).toHaveLength(2);
    expect(st.audioItems[0]!.gainDb).toBe(-2);
    expect(useSceneStore.temporal.getState().pastStates.length).toBe(pastBefore + 1);
    useSceneStore.temporal.getState().undo();
    expect(useSceneStore.getState().audioItems).toHaveLength(1);
    expect(useSceneStore.getState().items.get('box')!.startTime).toBe(5.7);
  });
});
