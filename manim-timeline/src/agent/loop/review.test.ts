import { describe, expect, it } from 'vitest';
import { createShape, createTextLine, defaultSceneDefaults } from '@/store/factories';
import type { FrameDef, ItemId, SceneItem, ShapeItem, TextLineItem } from '@/types/scene';
import { buildSystemPrompt } from '../systemPrompt';
import { REVIEW_PROMPT } from '../AgentPanel';
import { DraftSession } from './draft';
import { contrastOnBlack, reviewScene } from './review';
import { loopToolSpecs, runLoopTool } from './tools';

const frames: FrameDef[] = [{ id: 'home', col: 0, row: 0 }];

function text(id: string, raw: string, x: number, y: number, start: number, colour = '#ffffff'): TextLineItem {
  const t = createTextLine(defaultSceneDefaults(), start);
  t.id = id;
  t.label = id;
  t.raw = raw;
  t.x = x;
  t.y = y;
  t.duration = 1;
  t.segments = [{ ...t.segments[0]!, text: raw, color: colour }];
  t.measure = { widthInk: 3, heightInk: 0.5 } as never;
  return t;
}

function session(items: SceneItem[]) {
  return new DraftSession({
    items: new Map<ItemId, SceneItem>(items.map((it) => [it.id, it])),
    frames,
    startFrameId: 'home',
    activeFrameId: 'home',
    defaults: defaultSceneDefaults(),
    audioItems: [],
    currentTimeSec: 0,
  });
}

describe('review_scene', () => {
  it('measures contrast on black', () => {
    expect(contrastOnBlack('#ffffff')).toBeCloseTo(21, 5);
    expect(contrastOnBlack('#1e40af')!).toBeLessThan(3);
    expect(contrastOnBlack('#facc15')!).toBeGreaterThan(10);
    expect(contrastOnBlack('red')).toBeNull();
  });

  it('finds off-camera and overlapping text, dark colours, unwrapped English, idle stretches and export errors', () => {
    const dark: ShapeItem = { ...createShape(0), id: 'dark', label: 'dark circle', strokeColor: '#1e3a8a', strokeWidth: 3, duration: 1 };
    const broken: ShapeItem = {
      ...createShape(9),
      id: 'conn',
      label: 'broken connector',
      shapeType: 'line',
      duration: 0.5,
      endpoints: { start: { kind: 'object', itemId: 'gone' }, end: { kind: 'point', x: 0, y: 0 } },
    };
    const s = session([
      text('t1', 'שלום world', 0, 3, 0),
      text('t2', 'כותרת', 0.5, 3.1, 0.5),
      text('far', 'רחוק', 6.5, 0, 1),
      dark,
      broken,
    ]);
    const { findings } = reviewScene(s);
    const kinds = findings.map((f) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining(['offscreen', 'textOverlap', 'lowContrast', 'unwrappedText', 'idleGap', 'exportError']));
    expect(findings.find((f) => f.kind === 'offscreen')).toMatchObject({ itemIds: ['far'] });
    expect(findings.find((f) => f.kind === 'textOverlap')!.itemIds!.slice().sort()).toEqual(['t1', 't2']);
    expect(findings.find((f) => f.kind === 'lowContrast')).toMatchObject({ itemIds: ['dark'] });
    expect(findings.find((f) => f.kind === 'unwrappedText')!.message).toContain('\\en{…}');
    expect(findings.find((f) => f.kind === 'idleGap')!.range).toEqual([2, 9]);
    expect(findings.find((f) => f.kind === 'exportError')!.message).toMatch(/Connector/);
  });

  it('finds nothing in a clean scene, and is a loop tool the prompt teaches', async () => {
    const s = session([text('t1', 'שלום', 0, 2, 0), text('t2', 'עולם', 0, 0, 0.8)]);
    expect(reviewScene(s).findings).toEqual([]);
    expect(loopToolSpecs({}).map((t) => t.name)).toContain('review_scene');
    const out = await runLoopTool({ id: 'r', name: 'review_scene', input: {} }, s, {});
    expect(out.summary).toBe('Reviewed the scene: nothing to fix');
    expect(JSON.parse(out.result.text).findings).toEqual([]);
    expect(buildSystemPrompt('', 'loop')).toContain('R23. Review my scene');
    expect(REVIEW_PROMPT).toMatch(/^Review the whole scene/);
  });
});
