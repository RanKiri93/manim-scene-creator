import { describe, expect, it } from 'vitest';
import { migrateItemsToV43 } from '@/lib/migrateProjectToV43';
import type { SceneItem } from '@/types/scene';

describe('migrateItemsToV43', () => {
  it('backfills graph-dot flags and preserves explicit choices', () => {
    const dot = { kind: 'graphDot', id: 'd', axesId: 'a', dot: { id: 'p', dx: 1, dy: 1, color: '#fff', radius: 0.1, label: '', labelDir: 'UP' as const }, id2: 'd', label: 'dot', layer: 0, startTime: 0, duration: 1, x: 0, y: 0, scale: 1, posSteps: [] } as unknown as SceneItem;
    const migrated = migrateItemsToV43([dot])[0]!;
    expect(migrated.kind === 'graphDot' && migrated.dot).toMatchObject({ showCoordinates: false, showProjectionGuides: false });
    expect(migrateItemsToV43(migrateItemsToV43([dot]))).toEqual(migrateItemsToV43([dot]));
  });
  it('backfills graph-follow easing and preserves explicit easing', () => {
    const clip = { kind: 'target_animation', id: 'clip', mode: 'graphFollow', targets: [{ targetId: 'dot', graphPlotId: 'plot', targetX: 2 }, { targetId: 'dot2', graphPlotId: 'plot', targetX: 3, easing: 'linear' }] } as unknown as SceneItem;
    expect(migrateItemsToV43([clip])[0]).toMatchObject({ targets: [{ easing: 'smooth' }, { easing: 'linear' }] });
  });
  it('preserves already selected graph-dot annotation options', () => {
    const item = { kind: 'graphDot', id: 'd', axesId: 'a', dot: { id: 'd', dx: 0, dy: 0, color: '#fff', radius: .1, label: '', labelDir: 'UP', showCoordinates: true, showProjectionGuides: true } } as unknown as SceneItem;
    expect(migrateItemsToV43([item])[0]).toMatchObject({ dot: { showCoordinates: true, showProjectionGuides: true } });
  });
});
