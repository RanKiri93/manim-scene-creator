import { describe, expect, it } from 'vitest';
import { createAxes, defaultSceneDefaults } from '@/store/factories';
import type { AudioTrackItem, FrameDef, ItemId, SceneItem } from '@/types/scene';
import { findWords, narrationPayload, NARRATION_WORD_CAP, normalizeWord, wordsDuring, narrationWords } from '../narration';
import { buildContextPayload } from '../serialize';
import { buildSystemPrompt } from '../systemPrompt';
import { DraftSession } from './draft';
import { runLoopTool } from './tools';

/** "תראה את הנקודה בדיוק כשאני אומר בנקודה ואז היא שנעה" spoken from scene time 10 s, 0.5 s per word. */
function track(id = 'n1', startTime = 10, words = ['תראה', 'את', 'הנקודה', 'בדיוק', 'כשאני', 'אומר', 'בנקודה,', 'ואז', 'היא', 'שנעה.']): AudioTrackItem {
  return {
    id,
    text: words.join(' '),
    audioUrl: '',
    startTime,
    duration: words.length * 0.5,
    boundaries: words.map((word, i) => ({ word, start: i * 0.5, end: i * 0.5 + 0.4 })),
  };
}

const frames: FrameDef[] = [{ id: 'home', col: 0, row: 0 }];
function session(audioItems: AudioTrackItem[]) {
  const axes = createAxes(defaultSceneDefaults());
  axes.id = 'ax1';
  axes.xRange = [0, 4, 1];
  axes.yRange = [0, 2, 1];
  return new DraftSession({
    items: new Map<ItemId, SceneItem>([[axes.id, axes]]),
    frames,
    startFrameId: 'home',
    activeFrameId: 'home',
    defaults: defaultSceneDefaults(),
    audioItems,
    currentTimeSec: 0,
  });
}

describe('narration words', () => {
  it('finds words in scene time, with Hebrew prefixes, punctuation and niqqud', () => {
    const audio = [track()];
    expect(findWords(audio, 'שנעה')).toEqual([{ spoken: 'שנעה.', trackId: 'n1', start: 14.5, end: 14.9, match: 'exact', context: 'בנקודה, ואז היא שנעה.' }]);
    const nekuda = findWords(audio, 'נקודה');
    expect(nekuda.map((m) => [m.spoken, m.start, m.match])).toEqual([['הנקודה', 11, 'prefix'], ['בנקודה,', 13, 'prefix']]);
    expect(findWords(audio, 'בנקודה').map((m) => [m.start, m.match])).toEqual([[13, 'exact']]);
    expect(findWords(audio, 'בדיוק כשאני')[0]).toMatchObject({ spoken: 'בדיוק כשאני', start: 11.5, end: 12.4 });
    expect(findWords(audio, 'נְקוּדָה')).toHaveLength(2);
    expect(normalizeWord('"Point,"')).toBe('point');
    expect(findWords(audio, 'מהירות')).toEqual([]);
  });

  it('does not match a phrase across two tracks', () => {
    const audio = [track('a', 0, ['שלום', 'עולם']), track('b', 1, ['יפה', 'מאוד'])];
    expect(findWords(audio, 'עולם יפה')).toEqual([]);
    expect(findWords(audio, 'יפה מאוד')).toHaveLength(1);
  });

  it('sends each track with its words in scene time, cut after the cap', () => {
    const payload = buildContextPayload({ defaults: defaultSceneDefaults(), currentTime: 0, items: [], audioItems: [track()] });
    expect(payload.narration?.[0]).toMatchObject({ id: 'n1', startTime: 10, endTime: 15 });
    expect(payload.narration?.[0]?.words.slice(0, 2)).toEqual([['תראה', 10], ['את', 10.5]]);
    expect(buildContextPayload({ defaults: defaultSceneDefaults(), currentTime: 0, items: [] }).narration).toBeUndefined();
    const long = track('l', 0, Array.from({ length: NARRATION_WORD_CAP + 5 }, (_, i) => `w${i}`));
    expect(narrationPayload([long])[0]).toMatchObject({ wordsCut: 5 });
    expect(narrationPayload([long])[0]!.words).toHaveLength(NARRATION_WORD_CAP);
  });

  it('lists the words spoken inside a window', () => {
    expect(wordsDuring(narrationWords([track()]), 13, 14)).toBe('בנקודה, ואז');
  });
});

describe('Time things to the narration (R15)', () => {
  it('find_words reports matches, or that there is no narration', async () => {
    const withAudio = await runLoopTool({ id: 'f', name: 'find_words', input: { text: 'שנעה' } }, session([track()]), {});
    expect(JSON.parse(withAudio.result.text).matches[0]).toMatchObject({ start: 14.5 });
    expect(withAudio.summary).toBe('Found "שנעה" 1 time in the narration');
    const without = await runLoopTool({ id: 'f', name: 'find_words', input: { text: 'שנעה' } }, session([]), {});
    expect(JSON.parse(without.result.text).note).toMatch(/no narration/);
    expect((await runLoopTool({ id: 'f', name: 'find_words', input: {} }, session([]), {})).result.isError).toBe(true);
  });

  it('inspect shows what is spoken during each clip', async () => {
    const s = session([track()]);
    expect(
      s.propose([
        { action: 'CREATE', item: { id: 'p1', kind: 'graphPlot', axesId: 'ax1', label: 'f', fn: { jsExpr: 'x/2', pyExpr: 'x/2' }, xDomain: [0, 4] } },
        { action: 'CREATE', item: { id: 'd1', kind: 'graphDot', axesId: 'ax1', label: 'P', startTime: 13, duration: 0.4, dot: { attachment: { kind: 'function', graphPlotId: 'p1', x: 0 } } } },
        { action: 'CREATE', item: { id: 'm1', kind: 'target_animation', label: 'move', mode: 'graphFollow', startTime: 14.5, duration: 1, targets: [{ targetId: 'd1', targetX: 3 }] } },
      ]),
    ).toMatchObject({ ok: true });
    const facts = JSON.parse((await runLoopTool({ id: 'i', name: 'inspect_scene', input: { itemIds: ['d1', 'm1'] } }, s, {})).result.text);
    expect(facts.items.map((it: { spoken: string }) => it.spoken)).toEqual(['בנקודה,', 'שנעה.']);
  });

  it('teaches narration timing in both modes; the loop lists find_words', () => {
    const single = buildSystemPrompt('');
    const loop = buildSystemPrompt('', 'loop');
    for (const prompt of [single, loop]) {
      expect(prompt).toContain('13. Narration');
      expect(prompt).toContain('R15. Time things to the narration');
    }
    expect(loop).toContain('find_words({ text })');
    expect(single).not.toContain('find_words({ text })');
  });
});
