import { describe, expect, it } from 'vitest';
import { createTargetAnimation } from '@/store/factories';
import { migrateItemsToV36 } from '@/lib/migrateProjectToV36';

describe('migrateItemsToV36', () => {
  it('copies items without structural change', () => {
    const ta = createTargetAnimation('move', ['a1'], 1, 0.5);
    const out = migrateItemsToV36([ta]);
    expect(out).toHaveLength(1);
    expect(out[0]).not.toBe(ta as unknown as object);
    expect(out[0]).toMatchObject({
      kind: 'target_animation',
      id: ta.id,
      mode: 'move',
    });
  });
});
