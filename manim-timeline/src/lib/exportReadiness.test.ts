import { describe, expect, it } from 'vitest';
import { graphFollowExportBlock } from '@/lib/exportReadiness';
describe('graph-follow export guard', () => {
  it('leaves graph-follow and annotation-only readiness unblocked after codegen support', () => {
    expect(graphFollowExportBlock([])).toBeNull();
    expect(graphFollowExportBlock([{ kind: 'target_animation', mode: 'graphFollow' } as never])).toBeNull();
    expect(graphFollowExportBlock([{ kind: 'graphDot', dot: { showCoordinates: true } } as never])).toBeNull();
    expect(graphFollowExportBlock([{ kind: 'graphDot', dot: { showProjectionGuides: true } } as never])).toBeNull();
    expect(graphFollowExportBlock([{ kind: 'graphDot', dot: { showCoordinates: false, showProjectionGuides: false } } as never])).toBeNull();
    expect(graphFollowExportBlock([{ kind: 'graphDot', dot: { attachment: { kind: 'function', graphPlotId: 'plot', x: 1 } } } as never])).toBeNull();
    expect(graphFollowExportBlock([{ kind: 'graphDot', dot: { attachment: { kind: 'parametric', graphCurveId: 'curve', t: 1 }, labelFontSize: 24, labelColor: '#ff0000', labelSpacing: 0.2, coordinateFontSize: 20, coordinateColor: '#00ff00', coordinateDir: 'LEFT', coordinateSpacing: 0.3, coordinatePrecision: 3 } } as never])).toBeNull();
  });
});
