import { describe, expect, it } from 'vitest';
import { migrateItemsToV44 } from '@/lib/migrateProjectToV44';
import { createAxes, createGraphDotItem, createGraphPlot } from '@/store/factories';
import type { SceneItem } from '@/types/scene';
import { migrateItemsToCurrentVersion } from '@/lib/migrateLoadedItems';
import { resolveGraphDotPosition } from '@/lib/graphMotion';

describe('migrateItemsToV44', () => {
  it('backfills free attachments and annotation styles without changing graphFollow rows', () => {
    const dot = createGraphDotItem('axes');
    dot.dot.labelDir = 'LEFT';
    delete dot.dot.attachment;
    delete dot.dot.showCoordinates;
    delete dot.dot.showProjectionGuides;
    delete dot.dot.labelFontSize;
    delete dot.dot.labelColor;
    delete dot.dot.labelSpacing;
    delete dot.dot.coordinateFontSize;
    delete dot.dot.coordinateColor;
    delete dot.dot.coordinateDir;
    delete dot.dot.coordinateSpacing;
    delete dot.dot.coordinatePrecision;
    const clip = { kind: 'target_animation', id: 'legacy', label: '', layer: 0, startTime: 1, duration: 1, mode: 'graphFollow', targets: [{ targetId: dot.id, graphPlotId: 'plot', targetX: 2, easing: 'linear' }] } as unknown as SceneItem;
    const once = migrateItemsToV44([dot, clip]);
    const migratedDot = once.find((item) => item.kind === 'graphDot');
    expect(migratedDot?.kind === 'graphDot' && migratedDot.dot).toMatchObject({ attachment: { kind: 'free' }, showCoordinates: false, showProjectionGuides: false, labelFontSize: 18, labelColor: '#ffffff', labelSpacing: 0.15, coordinateFontSize: 18, coordinateColor: '#e2e8f0', coordinateDir: 'RIGHT', coordinateSpacing: 0.15, coordinatePrecision: 2 });
    expect(once.find((item) => item.id === 'legacy')).toEqual(clip);
    expect(migrateItemsToV44(once)).toEqual(once);
  });

  it('preserves valid attachments/style values and clamps coordinate precision', () => {
    const dot = createGraphDotItem('axes');
    dot.dot.attachment = { kind: 'parametric', graphCurveId: 'curve', t: 0.5 };
    dot.dot.coordinatePrecision = 99;
    dot.dot.coordinateColor = '#abcdef';
    const migrated = migrateItemsToV44([dot])[0];
    expect(migrated.kind === 'graphDot' && migrated.dot).toMatchObject({ attachment: { kind: 'parametric', graphCurveId: 'curve', t: 0.5 }, coordinatePrecision: 6, coordinateColor: '#abcdef' });
  });

  it('keeps a legacy V43 plot-backed graphFollow row usable after V44 load', () => {
    const axes = createAxes({ font: 'Alef', fontSize: 36, mathColor: '#fff', exportNamePrefix: '', sceneName: 'test' }); axes.id = 'a';
    const plot = createGraphPlot(axes.id); plot.id = 'p'; plot.fn.jsExpr = 'x*x';
    const dot = createGraphDotItem(axes.id); dot.id = 'd'; dot.dot.dx = 0; dot.dot.dy = 0; delete dot.dot.attachment;
    const follow = { kind: 'target_animation', id: 'f', label: '', layer: 0, startTime: 0, duration: 2, mode: 'graphFollow', targets: [{ targetId: 'd', graphPlotId: 'p', targetX: 2 }] } as unknown as SceneItem;
    const migrated = migrateItemsToCurrentVersion([axes, plot, dot, follow], 43);
    const migratedDot = migrated.find((item) => item.kind === 'graphDot');
    if (migratedDot?.kind !== 'graphDot') throw new Error('Expected migrated dot');
    expect(migratedDot.dot.attachment).toEqual({ kind: 'free' });
    expect(resolveGraphDotPosition({ dot: migratedDot, items: migrated, time: 1 }).error).toBeNull();
    expect(resolveGraphDotPosition({ dot: migratedDot, items: migrated, time: 3 }).point).toEqual({ x: 2, y: 4 });
  });
});
