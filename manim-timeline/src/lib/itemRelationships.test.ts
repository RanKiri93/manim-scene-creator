import { describe, expect, it } from 'vitest';
import type {
  BlinkAnimationItem,
  CameraMoveItem,
  ExitAnimationItem,
  SceneItem,
  SurroundingRectItem,
  TargetAnimationItem,
  TextLineItem,
} from '@/types/scene';
import {
  buildObjectPanelModel,
  itemPanelRole,
  nestedChildTitle,
  relatedCountLabel,
  relatedObjectIds,
} from '@/lib/itemRelationships';

function line(id: string, startTime: number, label = ''): TextLineItem {
  return {
    kind: 'textLine',
    id,
    label,
    layer: 0,
    startTime,
    duration: 2,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    audioTrackId: null,
    raw: label || 'line',
    font: 'Alef',
    fontSize: 36,
    segments: [],
    measure: null,
    measureError: null,
    previewDataUrl: null,
    segmentMeasures: null,
    mathChildMeasures: null,
  };
}

function exitFor(
  id: string,
  targetIds: string[],
  startTime: number,
): ExitAnimationItem {
  return {
    kind: 'exit_animation',
    id,
    label: '',
    layer: 0,
    startTime,
    duration: 1,
    targets: targetIds.map((targetId) => ({ targetId, animStyle: 'fade_out' })),
  };
}

function blinkFor(
  id: string,
  targetId: string,
  startTime: number,
): BlinkAnimationItem {
  return {
    kind: 'blink_animation',
    id,
    label: '',
    layer: 0,
    startTime,
    duration: 1,
    repetitions: 1,
    targets: [{ targetId, mode: 'scale' }],
  };
}

function targetFor(
  id: string,
  targetId: string,
  startTime: number,
): TargetAnimationItem {
  return {
    kind: 'target_animation',
    id,
    label: '',
    layer: 0,
    startTime,
    duration: 1,
    mode: 'color',
    targets: [{ targetId }],
  };
}

function rectFor(
  id: string,
  targetIds: string[],
  startTime: number,
): SurroundingRectItem {
  return {
    kind: 'surroundingRect',
    id,
    label: '',
    layer: 0,
    startTime,
    runTime: 1,
    targetIds,
    buff: 0.2,
    color: '#ffffff',
    cornerRadius: 0.1,
    strokeWidth: 2,
    labelText: '',
    labelDir: 'UP',
    labelFontSize: 24,
    introStyle: 'create',
  };
}

function camFor(id: string, startTime: number): CameraMoveItem {
  return {
    kind: 'camera_move',
    id,
    label: '',
    layer: 0,
    startTime,
    duration: 1,
    targetFrameId: 'frame-1',
  };
}

function model(items: SceneItem[]) {
  const itemsMap = new Map(items.map((it) => [it.id, it] as const));
  return buildObjectPanelModel(items, itemsMap);
}

describe('itemRelationships object grouping', () => {
  it('classifies objects, effects, and global clips', () => {
    expect(itemPanelRole(line('a', 0))).toBe('object');
    expect(itemPanelRole(rectFor('r', ['a'], 1))).toBe('object');
    expect(itemPanelRole(exitFor('x', ['a'], 2))).toBe('effect');
    expect(itemPanelRole(blinkFor('b', 'a', 2))).toBe('effect');
    expect(itemPanelRole(targetFor('t', 'a', 2))).toBe('effect');
    expect(itemPanelRole(camFor('c', 0))).toBe('global');
  });

  it('exposes related target ids only for targeting clips', () => {
    expect(relatedObjectIds(exitFor('x', ['a', 'b'], 2))).toEqual(['a', 'b']);
    expect(relatedObjectIds(rectFor('r', ['a'], 1))).toEqual(['a']);
    expect(relatedObjectIds(line('a', 0))).toEqual([]);
    expect(relatedObjectIds(camFor('c', 0))).toEqual([]);
  });

  it('nests exit/blink/target clips under their target with compact titles', () => {
    const items = [
      line('a', 0, 'Title'),
      blinkFor('b', 'a', 4),
      targetFor('t', 'a', 6),
      exitFor('x', ['a'], 8),
    ];
    const m = model(items);
    expect(m.groups).toHaveLength(1);
    expect(m.groups[0]!.object.id).toBe('a');
    expect(m.groups[0]!.children.map((c) => c.item.id)).toEqual(['b', 't', 'x']);
    expect(m.groups[0]!.children.map((c) => nestedChildTitle(c.item, 'a'))).toEqual([
      'Blink · scale',
      'Color',
      'Exit · FadeOut',
    ]);
    expect(m.unassigned).toEqual([]);
  });

  it('nests a surrounding rect under every target and keeps it as its own header', () => {
    const items = [line('a', 0), line('b', 1), rectFor('r', ['a', 'b'], 2)];
    const m = model(items);
    expect(m.groups.map((g) => g.object.id)).toEqual(['a', 'b', 'r']);
    expect(m.groups[0]!.children.map((c) => c.item.id)).toEqual(['r']);
    expect(m.groups[1]!.children.map((c) => c.item.id)).toEqual(['r']);
    expect(nestedChildTitle(m.groups[0]!.children[0]!.item, 'a')).toBe('Rect');
    // The rect header itself has no children; exits targeting it would nest there.
    expect(m.groups[2]!.children).toEqual([]);
  });

  it('references a multi-target clip under each target with one source id', () => {
    const items = [line('a', 0, 'A'), line('b', 1, 'B'), exitFor('x', ['a', 'b'], 5)];
    const m = model(items);
    const underA = m.groups[0]!.children[0]!;
    const underB = m.groups[1]!.children[0]!;
    expect(underA.item.id).toBe('x');
    expect(underB.item.id).toBe('x');
    expect(underA.targetCount).toBe(2);
    expect(underA.otherTargetNames).toEqual(['B']);
    expect(underB.otherTargetNames).toEqual(['A']);
    expect(m.unassigned).toEqual([]);
  });

  it('routes clips with missing or out-of-filter targets to unassigned', () => {
    // 'gone' was deleted; 'b' exists in the project but is filtered out of view.
    const visible = [line('a', 0), exitFor('x', ['gone'], 5), blinkFor('k', 'b', 6)];
    const itemsMap = new Map<SceneItem['id'], SceneItem>([
      ...visible.map((it) => [it.id, it] as const),
      ['b', line('b', 1)],
    ]);
    const m = buildObjectPanelModel(visible, itemsMap);
    expect(m.groups.map((g) => g.object.id)).toEqual(['a']);
    expect(m.groups[0]!.children).toEqual([]);
    expect(m.unassigned.map((it) => it.id)).toEqual(['x', 'k']);
  });

  it('flags a nested child when a sibling target is missing', () => {
    const visible = [line('a', 0, 'A'), exitFor('x', ['a', 'gone'], 5)];
    const m = model(visible);
    const child = m.groups[0]!.children[0]!;
    expect(child.item.id).toBe('x');
    expect(child.hasMissingTarget).toBe(true);
    expect(child.otherTargetNames).toEqual(['(missing)']);
  });

  it('does not nest effects under non-object targets', () => {
    // Stale data: an exit targeting another exit clip.
    const items = [line('a', 0), exitFor('inner', ['a'], 4), exitFor('outer', ['inner'], 6)];
    const m = model(items);
    expect(m.groups.map((g) => g.object.id)).toEqual(['a']);
    expect(m.groups[0]!.children.map((c) => c.item.id)).toEqual(['inner']);
    expect(m.unassigned.map((it) => it.id)).toEqual(['outer']);
  });

  it('keeps camera moves and unrelated globals unassigned in chronological order', () => {
    const items = [camFor('c2', 9), line('a', 0), camFor('c1', 2)];
    const m = model(items);
    expect(m.groups.map((g) => g.object.id)).toEqual(['a']);
    expect(m.unassigned.map((it) => it.id)).toEqual(['c1', 'c2']);
  });

  it('labels group counts', () => {
    expect(relatedCountLabel(1)).toBe('1 related');
    expect(relatedCountLabel(3)).toBe('3 related');
  });
});
