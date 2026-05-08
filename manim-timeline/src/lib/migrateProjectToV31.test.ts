import { describe, expect, it } from 'vitest';
import { createAxes, defaultSceneDefaults } from '@/store/factories';
import { migrateItemsToV31 } from '@/lib/migrateProjectToV31';

describe('migrateItemsToV31', () => {
  it('maps legacy tipLength to tipHeight and clears tipLength', () => {
    const ax = createAxes(defaultSceneDefaults(), 0);
    ax.tipLength = 0.25;

    const [out] = migrateItemsToV31([ax]);
    expect(out.kind).toBe('axes');
    if (out.kind !== 'axes') return;
    expect(out.tipHeight).toBe(0.25);
    expect(out.tipLength).toBeUndefined();
  });

  it('keeps existing tipHeight when both are present', () => {
    const ax = createAxes(defaultSceneDefaults(), 0);
    ax.tipHeight = 0.4;
    ax.tipLength = 0.25;

    const [out] = migrateItemsToV31([ax]);
    expect(out.kind).toBe('axes');
    if (out.kind !== 'axes') return;
    expect(out.tipHeight).toBe(0.4);
    expect(out.tipLength).toBeUndefined();
  });
});
