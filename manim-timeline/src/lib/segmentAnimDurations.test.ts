import { describe, expect, it } from 'vitest';
import type { SegmentStyle } from '@/types/scene';
import {
  applyWaitBodyShift,
  applyWaitEdgeResize,
  getSegmentAnimSec,
  normalizeSegmentAnimStyles,
  scaleSegmentAnimForLineDuration,
  setSegmentAnimSecAtIndex,
  shiftAnimBoundaryFromBaseline,
} from './segmentAnimDurations';

function seg(
  partial: Partial<SegmentStyle> & Pick<SegmentStyle, 'text'>,
): SegmentStyle {
  return {
    isMath: false,
    color: '#fff',
    bold: false,
    italic: false,
    ...partial,
  };
}

describe('getSegmentAnimSec', () => {
  it('splits evenly when no animSec', () => {
    const s = [seg({ text: 'a' }), seg({ text: 'b' })];
    expect(getSegmentAnimSec(s, 4)).toEqual([2, 2]);
  });

  it('assigns remainder to segments without animSec', () => {
    const s = [
      seg({ text: 'a', animSec: 1 }),
      seg({ text: 'b' }),
      seg({ text: 'c' }),
    ];
    const a = getSegmentAnimSec(s, 3);
    expect(a[0]).toBeCloseTo(1, 5);
    expect(a[1]).toBeCloseTo(1, 5);
    expect(a[2]).toBeCloseTo(1, 5);
    expect(a.reduce((x, y) => x + y, 0)).toBeCloseTo(3, 5);
  });
});

describe('normalizeSegmentAnimStyles', () => {
  it('clears animSec when equal split', () => {
    const s = [seg({ text: 'a', animSec: 1 }), seg({ text: 'b', animSec: 1 })];
    const n = normalizeSegmentAnimStyles(s, 2);
    expect(n[0]!.animSec).toBeUndefined();
    expect(n[1]!.animSec).toBeUndefined();
  });
});

describe('scaleSegmentAnimForLineDuration', () => {
  it('leaves segments unchanged when no custom animSec', () => {
    const s = [seg({ text: 'a' }), seg({ text: 'b' })];
    const n = scaleSegmentAnimForLineDuration(s, 2, 4);
    expect(n[0]!.animSec).toBeUndefined();
  });

  it('scales custom split when duration changes', () => {
    const s = [
      seg({ text: 'a', animSec: 2 }),
      seg({ text: 'b', animSec: 1 }),
    ];
    const n = scaleSegmentAnimForLineDuration(s, 3, 6);
    const arr = getSegmentAnimSec(n, 6);
    expect(arr[0]).toBeCloseTo(4, 4);
    expect(arr[1]).toBeCloseTo(2, 4);
  });
});

describe('applyWaitEdgeResize', () => {
  it('left edge grows wait by taking time from preceding anim only', () => {
    const s = [seg({ text: 'a', animSec: 2 }), seg({ text: 'b', animSec: 1 })];
    const w = [0.5, 0];
    const anim = getSegmentAnimSec(s, 3);
    const { segments: out, duration } = applyWaitEdgeResize(
      0,
      'left',
      1.2,
      s,
      anim,
      w,
    );
    expect(out[0]!.waitAfterSec).toBeCloseTo(1.2, 5);
    // Stored animSec must reflect the trade: only segment 0’s anim shrinks, segment 1 unchanged.
    expect(out[0]!.animSec).toBeCloseTo(1.3, 5);
    expect(out[1]!.animSec).toBeCloseTo(1, 5);
    const a = getSegmentAnimSec(out, duration);
    expect(a[0]!).toBeCloseTo(1.3, 5);
    expect(a[1]!).toBeCloseTo(1, 5);
    expect(duration + (out[0]!.waitAfterSec ?? 0)).toBeCloseTo(3.5, 4);
  });

  it('right edge trades with following anim, preserving total run', () => {
    const s = [seg({ text: 'a', animSec: 1 }), seg({ text: 'b', animSec: 2 })];
    const w = [0.5, 0];
    const anim = getSegmentAnimSec(s, 3);
    const before = durationPlusWaits(anim, w);
    const { segments: out, duration } = applyWaitEdgeResize(
      0,
      'right',
      1.0,
      s,
      anim,
      w,
    );
    const wa = getSegmentAnimSec(out, duration);
    const w2 = out.map((x) => x.waitAfterSec ?? 0);
    expect(durationPlusWaits(wa, w2)).toBeCloseTo(before, 5);
    expect(out[0]!.waitAfterSec).toBeCloseTo(1.0, 5);
    expect(wa[0]!).toBeCloseTo(1, 5);
    expect(wa[1]!).toBeCloseTo(1.5, 5);
  });

  it('right edge on last wait changes wait only (total run can change)', () => {
    const s = [seg({ text: 'a' }), seg({ text: 'b' })];
    const w = [0, 0.5];
    const anim = getSegmentAnimSec(s, 3);
    const { segments: out, duration } = applyWaitEdgeResize(
      1,
      'right',
      1.2,
      s,
      anim,
      w,
    );
    expect(duration).toBeCloseTo(3, 5);
    expect(out[1]!.waitAfterSec).toBeCloseTo(1.2, 5);
  });
});

function durationPlusWaits(anim: number[], w: number[]): number {
  return anim.reduce((a, b) => a + b, 0) + w.reduce((a, b) => a + b, 0);
}

describe('applyWaitBodyShift', () => {
  it('pulls wait growth from the preceding segment anim, not all segments', () => {
    const s = [
      seg({ text: 'a', animSec: 2 }),
      seg({ text: 'b', animSec: 1 }),
    ];
    const w0 = 0.5;
    const segs: SegmentStyle[] = [
      { ...s[0]!, waitAfterSec: w0 },
      { ...s[1]! },
    ];
    const { segments: out, duration } = applyWaitBodyShift(0, 0.3, segs, 3);
    expect(duration).toBeCloseTo(2.7, 5);
    expect(out[0]!.waitAfterSec).toBeCloseTo(0.8, 5);
    const anim = getSegmentAnimSec(out, duration);
    expect(anim[0]!).toBeCloseTo(1.7, 5);
    expect(anim[1]!).toBeCloseTo(1, 5);
  });
});

describe('shiftAnimBoundaryFromBaseline', () => {
  it('moves time between two adjacent segments', () => {
    const s = [seg({ text: 'a' }), seg({ text: 'b' })];
    const base = getSegmentAnimSec(s, 4);
    const out = shiftAnimBoundaryFromBaseline(s, 4, 0, 1, base);
    const arr = getSegmentAnimSec(out, 4);
    expect(arr[0]!).toBeCloseTo(3, 5);
    expect(arr[1]!).toBeCloseTo(1, 5);
  });
});

describe('setSegmentAnimSecAtIndex', () => {
  it('rebalances other segments when one animSec changes', () => {
    const s = [seg({ text: 'a' }), seg({ text: 'b' }), seg({ text: 'c' })];
    const out = setSegmentAnimSecAtIndex(s, 3, 1, 1.5);
    const arr = getSegmentAnimSec(out, 3);
    expect(arr[1]).toBeCloseTo(1.5, 4);
    expect(arr[0]).toBeCloseTo(0.75, 4);
    expect(arr[2]).toBeCloseTo(0.75, 4);
    expect(arr.reduce((x, y) => x + y, 0)).toBeCloseTo(3, 4);
  });
});
