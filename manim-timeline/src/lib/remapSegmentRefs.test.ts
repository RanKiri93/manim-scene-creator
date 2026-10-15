import { describe, expect, it } from 'vitest';
import type { SceneItem } from '@/types/scene';
import { remapSegmentRefsInPlace, type SegmentRemap } from './remapSegmentRefs';

// Old line "a || b || c" became "new || a || c": a 0→1, b gone, c 2→2. Then a split case.
const remap: SegmentRemap = { lineId: 'L', map: [[1], [], [2]], mathChanged: new Set() };
const split: SegmentRemap = { lineId: 'L', map: [[0, 1], [2]], mathChanged: new Set() };

const item = (x: object) => x as unknown as SceneItem;

describe('remapSegmentRefsInPlace', () => {
  it('remaps blink rows on the line and falls back to the whole line when all are gone', () => {
    const blink = item({
      kind: 'blink_animation',
      targets: [
        { targetId: 'L', segmentIndices: [0, 1], mathSubtargets: null },
        { targetId: 'L', segmentIndices: [1] },
        { targetId: 'other', segmentIndices: [0] },
      ],
    });
    expect(remapSegmentRefsInPlace(blink, remap)).toBe(true);
    expect((blink as { targets: { segmentIndices: unknown }[] }).targets.map((t) => t.segmentIndices)).toEqual([
      [1],
      null,
      [0],
    ]);
  });

  it('covers every piece of a split segment in index lists', () => {
    const rect = item({ kind: 'surroundingRect', targetIds: ['L'], segmentIndices: [0] });
    remapSegmentRefsInPlace(rect, split);
    expect((rect as { segmentIndices: number[] }).segmentIndices).toEqual([0, 1]);
  });

  it('drops math child refinements when the math segment changed or split', () => {
    const anim = item({
      kind: 'target_animation',
      targets: [
        {
          targetId: 'L',
          segmentIndices: [2],
          mathSubtargets: [
            { segmentIndex: 2, childIndices: [0] },
            { segmentIndex: 0, childIndices: [1] },
          ],
        },
      ],
    });
    remapSegmentRefsInPlace(anim, { ...remap, mathChanged: new Set([0]) });
    expect((anim as { targets: { mathSubtargets: unknown }[] }).targets[0]!.mathSubtargets).toEqual([
      { segmentIndex: 2, childIndices: [0] },
    ]);
  });

  it('remaps next_to references to the line and the line’s own self index', () => {
    const other = item({
      kind: 'shape',
      id: 'S',
      posSteps: [{ kind: 'next_to', refKind: 'line', refId: 'L', refSegmentIndex: 1, selfSegmentIndex: null }],
    });
    const self = item({
      kind: 'textLine',
      id: 'L',
      posSteps: [{ kind: 'next_to', refKind: 'shape', refId: 'S', refSegmentIndex: null, selfSegmentIndex: 0 }],
      transformConfig: null,
    });
    remapSegmentRefsInPlace(other, remap);
    remapSegmentRefsInPlace(self, remap);
    expect((other as { posSteps: { refSegmentIndex: unknown }[] }).posSteps[0]!.refSegmentIndex).toBeNull();
    expect((self as { posSteps: { selfSegmentIndex: unknown }[] }).posSteps[0]!.selfSegmentIndex).toBe(1);
  });

  it('remaps transform pairs on the target line (keys) and the source line (values)', () => {
    const target = item({
      kind: 'textLine',
      id: 'L',
      posSteps: [],
      transformConfig: { sourceLineId: 'S', segmentPairs: { 0: 5, 1: 6, 2: 7 } },
    });
    remapSegmentRefsInPlace(target, remap);
    expect((target as { transformConfig: { segmentPairs: unknown } }).transformConfig.segmentPairs).toEqual({
      1: 5,
      2: 7,
    });

    const later = item({
      kind: 'textLine',
      id: 'T',
      posSteps: [],
      transformConfig: { sourceLineId: 'L', segmentPairs: { 0: 0, 1: 1, 3: 2 } },
    });
    remapSegmentRefsInPlace(later, remap);
    expect((later as { transformConfig: { segmentPairs: unknown } }).transformConfig.segmentPairs).toEqual({
      0: 1,
      3: 2,
    });
  });

  it('reports no change for items that do not reference the line', () => {
    const blink = item({ kind: 'blink_animation', targets: [{ targetId: 'X', segmentIndices: [0] }] });
    expect(remapSegmentRefsInPlace(blink, remap)).toBe(false);
  });
});
