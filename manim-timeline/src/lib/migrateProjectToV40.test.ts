import { describe, expect, it } from 'vitest';
import { createTextLine, defaultSceneDefaults } from '@/store/factories';
import { migrateItemsToV40 } from '@/lib/migrateProjectToV40';
import type { TextLineItem } from '@/types/scene';

describe('migrateItemsToV40', () => {
  it('backfills sourceLineIds from sourceLineId', () => {
    const source = createTextLine(defaultSceneDefaults(), 0);
    source.id = 'src';
    const target = createTextLine(defaultSceneDefaults(), 1);
    target.id = 'tgt';
    target.animStyle = 'transform';
    target.transformConfig = {
      sourceLineId: source.id,
      mode: 'whole',
      segmentPairs: {},
      unmappedSourceBehavior: 'fade_out',
      unmappedTargetBehavior: 'fade_in',
    };

    const [, migratedTarget] = migrateItemsToV40([source, target]) as TextLineItem[];

    expect(migratedTarget.transformConfig?.sourceLineIds).toEqual([source.id]);
  });

  it('leaves existing sourceLineIds unchanged', () => {
    const a = createTextLine(defaultSceneDefaults(), 0);
    a.id = 'a';
    const b = createTextLine(defaultSceneDefaults(), 1);
    b.id = 'b';
    const target = createTextLine(defaultSceneDefaults(), 2);
    target.id = 'tgt';
    target.animStyle = 'transform';
    target.transformConfig = {
      sourceLineId: a.id,
      sourceLineIds: [a.id, b.id],
      mode: 'whole',
      segmentPairs: {},
      unmappedSourceBehavior: 'fade_out',
      unmappedTargetBehavior: 'fade_in',
    };

    const [, , migratedTarget] = migrateItemsToV40([a, b, target]) as TextLineItem[];

    expect(migratedTarget.transformConfig?.sourceLineIds).toEqual([a.id, b.id]);
  });
});
