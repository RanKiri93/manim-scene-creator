import { beforeEach, describe, expect, it } from 'vitest';
import { createTextLine, defaultFrames, defaultSceneDefaults } from '@/store/factories';
import { useSceneStore } from '@/store/useSceneStore';
import type { ItemId, MeasureResult, SceneItem, TextLineItem } from '@/types/scene';
import { staleTextLines, textLineMeasureKey } from './measureHooks';

function line(id: string, raw: string, patch: Partial<TextLineItem> = {}): TextLineItem {
  const item = createTextLine(defaultSceneDefaults());
  return { ...item, id, raw, ...patch };
}

const measured = { width: 1, height: 1 } as MeasureResult;
const map = (...items: SceneItem[]) => new Map<ItemId, SceneItem>(items.map((it) => [it.id, it]));

describe('staleTextLines', () => {
  it('picks every unmeasured line, not just one, and skips empty ones', () => {
    const seen = new Map<ItemId, string>();
    const stale = staleTextLines(map(line('a', 'x'), line('b', 'y'), line('c', '  ')), seen, true);
    expect(stale.map((s) => s.item.id)).toEqual(['a', 'b']);
  });

  it('trusts a line first met with a measure or an error, then re-measures it when it changes', () => {
    const seen = new Map<ItemId, string>();
    const a = line('a', 'x', { measure: measured });
    const b = line('b', 'bad', { measureError: 'TeX error' });
    expect(staleTextLines(map(a, b), seen, true)).toEqual([]);
    const edited = { ...a, raw: 'x + 1' };
    expect(staleTextLines(map(edited, b), seen, true).map((s) => s.item.id)).toEqual(['a']);
  });

  it('does not repeat a line already requested under the same key', () => {
    const a = line('a', 'x');
    const seen = new Map<ItemId, string>([['a', textLineMeasureKey(a, true)]]);
    expect(staleTextLines(map(a), seen, true)).toEqual([]);
    // Turning previews on or off asks again: the PNG depends on it.
    expect(staleTextLines(map(a), seen, false)).toHaveLength(1);
  });

  it('keys on colours (the preview is rendered in them) and forgets deleted lines', () => {
    const seg = { text: 'x', isMath: false, color: '#ffffff', bold: false, italic: false };
    const a = line('a', 'x', { segments: [seg] });
    const recoloured = { ...a, segments: [{ ...seg, color: '#ff0000' }] };
    expect(textLineMeasureKey(a, true)).not.toBe(textLineMeasureKey(recoloured, true));
    const seen = new Map<ItemId, string>([['gone', 'k']]);
    staleTextLines(map(), seen, true);
    expect(seen.has('gone')).toBe(false);
  });
});

describe('setMeasureResult', () => {
  beforeEach(() => {
    const config = defaultFrames();
    useSceneStore.getState().loadSceneDocument(
      { defaults: defaultSceneDefaults(), frames: config.frames, startFrameId: config.startFrameId, items: [], audioItems: undefined },
      42,
    );
    useSceneStore.temporal.getState().clear();
  });

  it('is not an undo step', () => {
    useSceneStore.getState().addItem(line('a', 'x'));
    const steps = useSceneStore.temporal.getState().pastStates.length;
    useSceneStore.getState().setMeasureResult('a', measured, null);
    expect(useSceneStore.temporal.getState().pastStates.length).toBe(steps);
    expect((useSceneStore.getState().items.get('a') as TextLineItem).measure).toBe(measured);
    // One Undo removes the line itself, not the measure.
    useSceneStore.temporal.getState().undo();
    expect(useSceneStore.getState().items.has('a')).toBe(false);
  });
});
