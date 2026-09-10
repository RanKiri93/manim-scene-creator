import { describe, expect, it } from 'vitest';
import {
  mapCloseRangePlayhead,
  mapInsertPlayhead,
  nextClipStartAfter,
  planCloseRange,
  planInsertTime,
  validateCloseRange,
  validateInsertTime,
  type SurgerySpan,
} from '@/lib/timelineSurgery';

function span(id: string, start: number, end: number): SurgerySpan {
  return { id, start, end, label: id };
}

describe('timelineSurgery close range', () => {
  it('rejects non-finite and non-positive ranges', () => {
    expect(validateCloseRange(Number.NaN, 5).ok).toBe(false);
    expect(validateCloseRange(0, Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(validateCloseRange(5, 5).ok).toBe(false);
    expect(validateCloseRange(6, 5).ok).toBe(false);
    expect(validateCloseRange(-1, 5).ok).toBe(false);
    const good = validateCloseRange(2, 5);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.delta).toBeCloseTo(3, 10);
  });

  it('reports blockers for clips intersecting the range', () => {
    const items = [span('a', 0, 2), span('b', 4, 8), span('c', 10, 12)];
    const audios = [span('u', 5, 6)];
    const plan = planCloseRange(items, audios, 3, 9);
    expect(plan.ok).toBe(false);
    expect(plan.error).toBeTruthy();
    expect(plan.blockers.map((b) => b.id).sort()).toEqual(['b', 'u']);
    expect(plan.itemUpdates).toEqual([]);
    expect(plan.audioUpdates).toEqual([]);
  });

  it('allows clips ending at start and starting at end', () => {
    const items = [span('a', 0, 3), span('b', 9, 11)];
    const plan = planCloseRange(items, [], 3, 9);
    expect(plan.ok).toBe(true);
    expect(plan.blockers).toEqual([]);
    expect(plan.itemUpdates).toEqual([{ id: 'b', startTime: 3 }]);
  });

  it('shifts clips starting at or after end left by the delta', () => {
    const items = [span('a', 0, 1), span('b', 6, 8), span('c', 9, 10)];
    const audios = [span('u', 7, 9), span('v', 1, 2)];
    const plan = planCloseRange(items, audios, 2, 6);
    expect(plan.ok).toBe(true);
    expect(plan.delta).toBeCloseTo(4, 10);
    expect(plan.itemUpdates).toEqual([
      { id: 'b', startTime: 2 },
      { id: 'c', startTime: 5 },
    ]);
    expect(plan.audioUpdates).toEqual([{ id: 'u', startTime: 3 }]);
  });

  it('maps the playhead through a close edit', () => {
    expect(mapCloseRangePlayhead(1, 3, 7)).toBe(1);
    expect(mapCloseRangePlayhead(3, 3, 7)).toBe(3);
    expect(mapCloseRangePlayhead(5, 3, 7)).toBe(3);
    expect(mapCloseRangePlayhead(7, 3, 7)).toBe(3);
    expect(mapCloseRangePlayhead(10, 3, 7)).toBe(6);
  });
});

describe('timelineSurgery insert empty time', () => {
  it('rejects non-finite, negative point, and non-positive duration', () => {
    expect(validateInsertTime(Number.NaN, 2).ok).toBe(false);
    expect(validateInsertTime(1, Number.NaN).ok).toBe(false);
    expect(validateInsertTime(-1, 2).ok).toBe(false);
    expect(validateInsertTime(1, 0).ok).toBe(false);
    expect(validateInsertTime(1, -2).ok).toBe(false);
    expect(validateInsertTime(1, 2).ok).toBe(true);
  });

  it('reports blockers for clips spanning the insertion point', () => {
    const items = [span('a', 0, 2), span('b', 4, 8)];
    const audios = [span('u', 4.5, 5.5), span('v', 5, 6)];
    const plan = planInsertTime(items, audios, 5, 2);
    expect(plan.ok).toBe(false);
    expect(plan.error).toBeTruthy();
    expect(plan.blockers.map((b) => b.id).sort()).toEqual(['b', 'u']);
    expect(plan.itemUpdates).toEqual([]);
  });

  it('allows insertion at exact clip boundaries', () => {
    const items = [span('a', 0, 5), span('b', 5, 9)];
    const plan = planInsertTime(items, [], 5, 2);
    expect(plan.ok).toBe(true);
    expect(plan.blockers).toEqual([]);
    expect(plan.itemUpdates).toEqual([{ id: 'b', startTime: 7 }]);
  });

  it('shifts clips starting at or after the point right by the duration', () => {
    const items = [span('a', 0, 2), span('b', 6, 8)];
    const audios = [span('u', 6, 7), span('v', 0, 1)];
    const plan = planInsertTime(items, audios, 6, 2.5);
    expect(plan.ok).toBe(true);
    expect(plan.itemUpdates).toEqual([{ id: 'b', startTime: 8.5 }]);
    expect(plan.audioUpdates).toEqual([{ id: 'u', startTime: 8.5 }]);
  });

  it('ignores scene-level state that carries no span (e.g. AudioBed)', () => {
    // The planners only receive visual/audio spans; anything without a
    // startTime (like the full-scene background bed) is never passed in and
    // therefore can never move or block.
    const plan = planInsertTime([span('a', 4, 6)], [], 2, 1);
    expect(plan.ok).toBe(true);
    expect(plan.itemUpdates).toEqual([{ id: 'a', startTime: 5 }]);
  });

  it('maps the playhead through an insert edit', () => {
    expect(mapInsertPlayhead(1, 4, 2)).toBe(1);
    expect(mapInsertPlayhead(4, 4, 2)).toBe(4);
    expect(mapInsertPlayhead(6, 4, 2)).toBe(8);
  });

  it('finds the next clip start after a time', () => {
    const items = [span('a', 0, 1), span('b', 6, 8)];
    const audios = [span('u', 4, 5)];
    expect(nextClipStartAfter(items, audios, 0)).toBeCloseTo(4, 10);
    expect(nextClipStartAfter(items, audios, 4)).toBeCloseTo(6, 10);
    expect(nextClipStartAfter(items, audios, 6)).toBeNull();
  });
});
