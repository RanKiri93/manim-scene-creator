import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from '@/store/useSceneStore';
import { parseSegments } from '@/lib/textSegments';
import type { BlinkAnimationItem, SegmentStyle, TextLineItem } from '@/types/scene';

function line(id: string, raw: string, styles: Record<number, Partial<SegmentStyle>> = {}): TextLineItem {
  return {
    kind: 'textLine',
    id,
    label: '',
    layer: 0,
    startTime: 0,
    duration: 2,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    audioTrackId: null,
    raw,
    font: 'Alef',
    fontSize: 36,
    segments: parseSegments(raw).map((p, i) => ({
      text: p.text,
      isMath: p.isMath,
      color: '#ffffff',
      bold: false,
      italic: false,
      ...styles[i],
    })),
    measure: null,
    measureError: null,
    previewDataUrl: null,
    segmentMeasures: null,
    mathChildMeasures: null,
  };
}

function blink(id: string, targetId: string, segmentIndices: number[]): BlinkAnimationItem {
  return {
    kind: 'blink_animation',
    id,
    label: '',
    layer: 1,
    startTime: 1,
    duration: 0.5,
    targets: [{ targetId, mode: 'scale', segmentIndices }],
  } as BlinkAnimationItem;
}

function reset() {
  useSceneStore.setState((s) => {
    s.items.clear();
    s.selectedIds.clear();
    s.inspectedId = null;
  });
  useSceneStore.temporal.getState().clear();
}

const textLine = (id: string) => useSceneStore.getState().items.get(id) as TextLineItem;

describe('setTextLineSource', () => {
  beforeEach(reset);

  it('keeps colour and wait on a retyped segment and remaps a blink in one undo step', () => {
    useSceneStore.setState((s) => {
      s.items.set('l1', line('l1', 'אם || פונקציה || רציפה', { 1: { color: '#ff0000', waitAfterSec: 0.4 } }));
      s.items.set('b1', blink('b1', 'l1', [2]));
    });
    useSceneStore.temporal.getState().clear();

    useSceneStore.getState().setTextLineSource('l1', 'חדש || אם || פונקצייה || רציפה');

    const segs = textLine('l1').segments;
    // New text segments default to white; the retyped one keeps its red.
    expect(segs.map((s) => s.color)).toEqual(['#ffffff', '#ffffff', '#ff0000', '#ffffff']);
    expect(segs[2]!.waitAfterSec).toBe(0.4);
    const b = useSceneStore.getState().items.get('b1') as BlinkAnimationItem;
    expect(b.targets[0]!.segmentIndices).toEqual([3]);
    expect(useSceneStore.temporal.getState().pastStates.length).toBe(1);
  });

  it('switches direction and keeps settings', () => {
    useSceneStore.setState((s) => {
      s.items.set('l1', line('l1', 'The||function', { 1: { color: '#ff0000' } }));
    });
    useSceneStore.getState().setTextLineSource('l1', 'The||function', 'ltr');
    expect(textLine('l1').baseDir).toBe('ltr');
    expect(textLine('l1').segments[1]!.color).toBe('#ff0000');
  });

  it('applies segment patches (style only) after matching', () => {
    useSceneStore.setState((s) => {
      s.items.set('l1', line('l1', 'סדרות פונקציות'));
    });
    useSceneStore.getState().setTextLineSource('l1', 'סדרות|| פונקציות', undefined, [
      { color: '#00ff00', text: 'ignored' },
    ]);
    const segs = textLine('l1').segments;
    expect(segs.map((s) => [s.text, s.color])).toEqual([
      ['סדרות', '#00ff00'],
      [' פונקציות', '#ffffff'],
    ]);
  });
});
