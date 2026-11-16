import { beforeEach, describe, expect, it } from 'vitest';
import { defaultSceneDefaults } from '@/store/factories';
import { useSceneStore } from '@/store/useSceneStore';
import { FRAME_W } from '@/lib/constants';
import type { CameraMoveItem, FrameDef, ItemId, SceneItem } from '@/types/scene';
import { commitActions } from './commit';
import { DraftSession } from './loop/draft';
import { applyFrameEdits, normalizeFrameEdit, planFrameEdits } from './frameEdits';
import { validateAgentResponse } from './validate';
import { AGENT_CHAT_RESPONSE_JSON_SCHEMA } from './types';
import { GEMINI_RESPONSE_SCHEMA } from './providers/gemini';

const home: FrameDef = { id: 'home', col: 0, row: 0, label: 'Frame 1' };
const ctx = { activeFrameId: 'home' };

const moveLeft = [
  { action: 'FRAME', edit: { op: 'add', id: 'f2', direction: 'left', label: 'Proof' } },
  { action: 'CREATE', item: { id: 'cam1', kind: 'camera_move', label: 'To proof', layer: 0, startTime: 1, duration: 1.5, targetMode: 'frame', targetFrameId: 'f2' } },
];

describe('normalizeFrameEdit', () => {
  it('resolves a direction from the active frame to a grid cell', () => {
    expect(normalizeFrameEdit({ op: 'add', id: 'f2', direction: 'left' }, [home], ctx)).toEqual({ edit: { op: 'add', id: 'f2', col: -1, row: 0 } });
    expect(normalizeFrameEdit({ op: 'add', id: 'f2', direction: 'up' }, [home], ctx)).toEqual({ edit: { op: 'add', id: 'f2', col: 0, row: -1 } });
    expect(normalizeFrameEdit({ op: 'add', id: 'f2', direction: 'down', label: ' Lemma ' }, [home], ctx)).toEqual({ edit: { op: 'add', id: 'f2', col: 0, row: 1, label: 'Lemma' } });
  });

  it('measures from fromFrameId when given, or takes an explicit cell', () => {
    const right: FrameDef = { id: 'r', col: 1, row: 0 };
    expect(normalizeFrameEdit({ op: 'add', id: 'f3', direction: 'right', fromFrameId: 'r' }, [home, right], ctx)).toEqual({ edit: { op: 'add', id: 'f3', col: 2, row: 0 } });
    expect(normalizeFrameEdit({ op: 'add', id: 'f3', col: 4, row: 2 }, [home], ctx)).toEqual({ edit: { op: 'add', id: 'f3', col: 4, row: 2 } });
  });

  it('refuses a taken cell, a reused id and a missing position', () => {
    const left: FrameDef = { id: 'left', col: -1, row: 0 };
    const taken = normalizeFrameEdit({ op: 'add', id: 'f2', direction: 'left' }, [home, left], ctx);
    expect('error' in taken && taken.error).toMatch(/already holds frame "left"/);
    expect('error' in normalizeFrameEdit({ op: 'add', id: 'home', direction: 'left' }, [home], ctx)).toBe(true);
    expect('error' in normalizeFrameEdit({ op: 'add', id: 'obj', direction: 'left' }, [home], { ...ctx, isItemId: (id) => id === 'obj' })).toBe(true);
    expect('error' in normalizeFrameEdit({ op: 'add', id: 'f2' }, [home], ctx)).toBe(true);
    expect('error' in normalizeFrameEdit({ op: 'add', id: 'f2', direction: 'left', fromFrameId: 'nope' }, [home], ctx)).toBe(true);
  });

  it('renames an existing frame only', () => {
    expect(normalizeFrameEdit({ op: 'rename', frameId: 'home', label: 'Intro' }, [home], ctx)).toEqual({ edit: { op: 'rename', frameId: 'home', label: 'Intro' } });
    expect('error' in normalizeFrameEdit({ op: 'rename', frameId: 'x', label: 'Intro' }, [home], ctx)).toBe(true);
  });

  it('plans edits in order so a second frame can be placed next to the first new one', () => {
    const plan = planFrameEdits(
      [
        { action: 'FRAME', edit: { op: 'add', id: 'a', direction: 'left' } },
        { action: 'FRAME', edit: { op: 'add', id: 'b', direction: 'left', fromFrameId: 'a' } },
        { action: 'FRAME', edit: { op: 'add', id: 'c', direction: 'left' } },
      ],
      [home],
      ctx,
    );
    expect(plan.frames.map((f) => [f.id, f.col])).toEqual([['home', 0], ['a', -1], ['b', -2]]);
    expect(plan.errors.get(2)).toMatch(/already holds frame "a"/);
    expect(applyFrameEdits([home], [{ op: 'rename', frameId: 'home', label: 'X' }])[0]!.label).toBe('X');
  });
});

describe('FRAME actions in a proposal', () => {
  const frameCtx = { frameIds: ['home'], frames: [home], activeFrameId: 'home', startFrameId: 'home' };

  it('lets a camera move and a new item use the frame added in the same proposal', () => {
    const result = validateAgentResponse(
      {
        reply: 'ok',
        actions: [
          ...moveLeft,
          { action: 'CREATE', item: { id: 't1', kind: 'textLine', label: '', layer: 0, startTime: 2, duration: 1, raw: 'שלום', frameId: 'f2' } },
        ],
      },
      new Map(),
      frameCtx,
    );
    expect(result.ok, result.ok ? '' : result.errors.join('\n')).toBe(true);
    if (!result.ok) return;
    expect(result.response.actions[0]).toEqual({ action: 'FRAME', edit: { op: 'add', id: 'f2', col: -1, row: 0, label: 'Proof' } });
  });

  it('reports a bad FRAME edit and a camera move to an unknown frame', () => {
    const result = validateAgentResponse(
      { reply: 'bad', actions: [{ action: 'FRAME', edit: { op: 'add', id: 'f2', direction: 'sideways' } }] },
      new Map(),
      frameCtx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/actions\[0\]: FRAME add: direction/);
  });

  it('tool-loop draft resolves the camera move against the new frame and exposes it', () => {
    const draft = new DraftSession({
      items: new Map<ItemId, SceneItem>(),
      frames: [home],
      startFrameId: 'home',
      activeFrameId: 'home',
      defaults: defaultSceneDefaults(),
      audioItems: [],
      currentTimeSec: 0,
    });
    const r = draft.propose(structuredClone(moveLeft));
    expect(r.ok, r.ok ? '' : r.errors.join('\n')).toBe(true);
    expect(draft.frames().map((f) => f.id)).toEqual(['home', 'f2']);
    const cam = draft.scene().get('cam1') as CameraMoveItem;
    expect(cam).toMatchObject({ targetFrameId: 'f2', targetWidth: FRAME_W, offsetX: 0, offsetY: 0 });
  });

  it('both provider schemas offer the FRAME action', () => {
    const variants = AGENT_CHAT_RESPONSE_JSON_SCHEMA.properties.actions.items.anyOf;
    expect(variants.some((v) => (v.properties.action.enum as readonly string[]).includes('FRAME'))).toBe(true);
    const flat = GEMINI_RESPONSE_SCHEMA.properties.actions.items.properties;
    expect(flat.action.enum).toContain('FRAME');
    expect(Object.keys(flat.edit.properties)).toEqual(expect.arrayContaining(['id', 'direction', 'fromFrameId', 'col', 'row', 'label', 'frameId']));
  });
});

describe('committing FRAME actions', () => {
  beforeEach(() => {
    useSceneStore.getState().loadSceneDocument(
      { defaults: defaultSceneDefaults(), frames: [{ ...home }], startFrameId: 'home', items: [], audioItems: undefined },
      42,
    );
    useSceneStore.temporal.getState().clear();
  });

  it('adds the frame before the camera move that targets it, as one undo step', () => {
    const result = validateAgentResponse({ reply: 'ok', actions: structuredClone(moveLeft) }, new Map(useSceneStore.getState().items), {
      frameIds: ['home'],
      frames: useSceneStore.getState().frames,
      activeFrameId: 'home',
      startFrameId: 'home',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Camera first in the list: the commit still adds the frame before it.
    commitActions([...result.response.actions].reverse());
    const s = useSceneStore.getState();
    expect(s.frames.find((f) => f.id === 'f2')).toEqual({ id: 'f2', col: -1, row: 0, label: 'Proof' });
    expect(s.items.get('cam1')).toMatchObject({ kind: 'camera_move', targetFrameId: 'f2' });
    useSceneStore.temporal.getState().undo();
    const after = useSceneStore.getState();
    expect(after.frames.map((f) => f.id)).toEqual(['home']);
    expect(after.items.has('cam1')).toBe(false);
  });
});
