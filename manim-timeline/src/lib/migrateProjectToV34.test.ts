import { describe, expect, it } from 'vitest';
import { createBlinkAnimation } from '@/store/factories';
import { migrateItemsToV34 } from '@/lib/migrateProjectToV34';

describe('migrateItemsToV34', () => {
  it('maps legacy scale_color blink rows to scale', () => {
    const blink = createBlinkAnimation(['line-1'], 0, 0.5);
    blink.targets[0]!.mode = 'scale_color' as typeof blink.targets[number]['mode'];

    const out = migrateItemsToV34([blink]);

    expect(out[0]?.kind).toBe('blink_animation');
    if (out[0]?.kind !== 'blink_animation') return;
    expect(out[0].targets[0]?.mode).toBe('scale');
  });
});
