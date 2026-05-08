import { describe, expect, it } from 'vitest';
import { createTextLine, defaultSceneDefaults, createBlinkAnimation } from '@/store/factories';
import { migrateItemsToV32 } from '@/lib/migrateProjectToV32';

describe('migrateItemsToV32', () => {
  it('passes through items unchanged (blink_animation forward compat)', () => {
    const line = createTextLine(defaultSceneDefaults(), 0);
    line.id = 'l1';
    const blink = createBlinkAnimation([line.id], 1, 0.5);
    const out = migrateItemsToV32([line, blink]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(line);
    expect(out[1]).toEqual(blink);
  });
});
