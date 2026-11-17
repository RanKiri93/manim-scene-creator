import { describe, expect, it } from 'vitest';
import type { ItemId, SceneItem } from '@/types/scene';
import { createShape, createTextLine, defaultSceneDefaults } from '@/store/factories';
import { canBeBlinkTarget, canBeSurroundTarget } from '@/lib/time';
import { describeAnimationTargets, resolveAnimationTargets } from './targetScope';

function scene() {
  const d = defaultSceneDefaults();
  const a = createTextLine(d, 2);
  Object.assign(a, { id: 'a', label: 'Title', raw: 'a', frameId: 'f1' });
  const b = createTextLine(d, 1);
  Object.assign(b, { id: 'b', label: 'Proof', raw: 'b', frameId: 'f1' });
  const c = createShape(0);
  Object.assign(c, { id: 'c', label: 'Box', frameId: 'f2' });
  return new Map<ItemId, SceneItem>([a, b, c].map((it) => [it.id, it]));
}

describe('resolveAnimationTargets', () => {
  it('uses the selected objects that can take the clip', () => {
    expect(resolveAnimationTargets(['a', 'c'], scene(), canBeBlinkTarget, 'f1', 'f1')).toEqual({ ids: ['a', 'c'], fromSelection: true });
  });

  it('falls back to the earliest object in the active frame', () => {
    expect(resolveAnimationTargets([], scene(), canBeBlinkTarget, 'f1', 'f1')).toEqual({ ids: ['b'], fromSelection: false });
    expect(resolveAnimationTargets([], scene(), canBeBlinkTarget, 'f1', 'f2')).toEqual({ ids: ['c'], fromSelection: false });
  });

  it('keeps surround targets in the first selected object’s frame', () => {
    expect(resolveAnimationTargets(['a', 'c', 'b'], scene(), canBeSurroundTarget, 'f1', 'f1', { sameFrameAsFirst: true }).ids).toEqual(['a', 'b']);
  });

  it('finds nothing when no object can take it', () => {
    expect(resolveAnimationTargets([], scene(), () => false, 'f1', 'f1')).toEqual({ ids: [], fromSelection: false });
  });
});

describe('describeAnimationTargets', () => {
  const items = scene();
  it('names the target, the fallback, or that there is none', () => {
    expect(describeAnimationTargets({ ids: ['a'], fromSelection: true }, items, true).text).toBe('Will target “Title”.');
    expect(describeAnimationTargets({ ids: ['a', 'b'], fromSelection: true }, items, true).text).toBe('Will target 2 selected: “Title”, “Proof”.');
    expect(describeAnimationTargets({ ids: ['b'], fromSelection: false }, items, true).text).toBe('The selection cannot take it; will target “Proof” instead.');
    expect(describeAnimationTargets({ ids: ['b'], fromSelection: false }, items, false).text).toMatch(/^Will target “Proof” \(earliest in this frame\)/);
    expect(describeAnimationTargets({ ids: [], fromSelection: false }, items, false)).toEqual({ text: 'Nothing in this frame can take it.', none: true });
  });
});

