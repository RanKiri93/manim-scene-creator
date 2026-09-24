import { describe, expect, it } from 'vitest';
import { effectiveSnapPixelsPerUnit, isFreelyDraggable } from '@/canvas/hooks/useDragSnap';

describe('text drag snap adapter prerequisites', () => {
  it('keeps absolute chains draggable and relative placement locked', () => {
    expect(isFreelyDraggable([])).toBe(true);
    expect(isFreelyDraggable([{ kind: 'absolute' }, { kind: 'absolute' }])).toBe(true);
    expect(isFreelyDraggable([{ kind: 'to_edge', edge: 'RIGHT', buff: 0.3 }])).toBe(false);
    expect(isFreelyDraggable([{ kind: 'set_x', x: 0 }])).toBe(false);
  });

  it('preserves CSS-pixel snap thresholds under camera zoom', () => {
    expect(effectiveSnapPixelsPerUnit(80, 2)).toBe(160);
    expect(effectiveSnapPixelsPerUnit(80, 0.5)).toBe(40);
  });
});
