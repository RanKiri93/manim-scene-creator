import { describe, expect, it } from 'vitest';
import { createGraphArea } from '@/store/factories';
import type { GraphAreaItem, ItemId, SceneItem } from '@/types/scene';
import { AREA_REVEAL_MIN_SHARE, areaRevealWindow, effectiveAreaIntroStyle } from './graphAreaReveal';
import { graphAreaIntroProgress, manimSmoothProgress } from './visualPlaybackPreview';

describe('areaRevealWindow', () => {
  it('sweeps from either edge and rises from the lower boundary', () => {
    expect(areaRevealWindow('sweep_right', 1, 3, 0.25)).toEqual({ lo: 1, hi: 1.5, k: 1 });
    expect(areaRevealWindow('sweep_left', 1, 3, 0.25)).toEqual({ lo: 2.5, hi: 3, k: 1 });
    expect(areaRevealWindow('rise', 1, 3, 0.25)).toEqual({ lo: 1, hi: 3, k: 0.25 });
    expect(areaRevealWindow('fade_in', 1, 3, 0.25)).toEqual({ lo: 1, hi: 3, k: 1 });
  });

  it('never collapses to nothing and stops at the full area', () => {
    expect(areaRevealWindow('sweep_right', 0, 1, 0).hi).toBe(AREA_REVEAL_MIN_SHARE);
    expect(areaRevealWindow('rise', 0, 1, 2).k).toBe(1);
  });
});

describe('graph area entrance', () => {
  const area = (patch: Partial<GraphAreaItem>): GraphAreaItem => ({ ...createGraphArea('ax', 1), id: 'a', duration: 2, ...patch });

  it('uses the chosen style for curve areas and fades other shapes', () => {
    expect(effectiveAreaIntroStyle(area({}))).toBe('fade_in');
    expect(effectiveAreaIntroStyle(area({ introStyle: undefined }))).toBe('fade_in');
    expect(effectiveAreaIntroStyle(area({ introStyle: 'rise' }))).toBe('rise');
    expect(effectiveAreaIntroStyle(area({ introStyle: 'rise', mode: { areaKind: 'disk', cx: 0, cy: 0, radius: 1 } }))).toBe('fade_in');
  });

  it('progresses with Manim smooth easing over the clip', () => {
    const a = area({ introStyle: 'sweep_right' });
    const items = new Map<ItemId, SceneItem>([[a.id, a]]);
    expect(graphAreaIntroProgress(a, 0.5, items)).toBe(0);
    expect(graphAreaIntroProgress(a, 1.5, items)).toBeCloseTo(manimSmoothProgress(0.25));
    expect(graphAreaIntroProgress(a, 3.5, items)).toBe(1);
  });
});
