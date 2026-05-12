import { describe, expect, it } from 'vitest';
import { createTextLine, defaultSceneDefaults, createBlinkAnimation } from '@/store/factories';
import { migrateItemsToV33 } from '@/lib/migrateProjectToV33';
import type { TextLineItem } from '@/types/scene';

describe('migrateItemsToV33', () => {
  it('adds mathChildMeasures null to text lines', () => {
    const line = createTextLine(defaultSceneDefaults(), 0);
    line.id = 'l1';
    const stripped = { ...line } as TextLineItem & { mathChildMeasures?: null };
    delete (stripped as { mathChildMeasures?: unknown }).mathChildMeasures;

    const out = migrateItemsToV33([stripped as TextLineItem]);
    expect(out[0]?.kind).toBe('textLine');
    expect((out[0] as TextLineItem).mathChildMeasures).toBeNull();
  });

  it('passes through blink_animation unchanged', () => {
    const line = createTextLine(defaultSceneDefaults(), 0);
    line.id = 'l1';
    const blink = createBlinkAnimation([line.id], 1, 0.5);
    const out = migrateItemsToV33([line, blink]);
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual(blink);
  });
});
