import { describe, expect, it } from 'vitest';
import { createGraphDot } from '@/store/factories';
import { buildGraphAnnotationLayout } from '@/lib/graphAnnotationLayout';

describe('graph annotation layout', () => {
  it('keeps fixed and live coordinate style/layout independent', () => {
    const dot = createGraphDot();
    dot.label = 'A'; dot.labelDir = 'RIGHT'; dot.labelFontSize = 36; dot.labelColor = '#ff0000'; dot.labelSpacing = 0.3;
    dot.showCoordinates = true; dot.coordinateFontSize = 18; dot.coordinateColor = '#00ff00'; dot.coordinateSpacing = 0.1; dot.coordinatePrecision = 3;
    dot.coordinateDir = 'LEFT';
    const layout = buildGraphAnnotationLayout({ dot, point: { x: 10, y: 20 }, coordinate: { x: 1, y: Math.sin(1) }, radiusPx: 8, pxPerUnit: 100 });
    expect(layout.coordinateText).toBe('(1.000, 0.841)');
    expect(layout.fixedLabel).toMatchObject({ text: 'A', fill: '#ff0000', fontSize: 20, align: 'right', direction: 'rtl' });
    expect(layout.coordinates).toMatchObject({ text: '(1.000, 0.841)', fill: '#00ff00', fontSize: 10, align: 'right' });
    expect(layout.fixedLabel!.x).toBeGreaterThan(layout.coordinates!.x);
  });

  it('uses the opposite direction by default and has no rich-font styling contract', () => {
    const dot = createGraphDot(); dot.label = 'fixed'; dot.showCoordinates = true; dot.labelDir = 'UP';
    const layout = buildGraphAnnotationLayout({ dot, point: { x: 0, y: 0 }, coordinate: { x: 0, y: 0 }, radiusPx: 4, pxPerUnit: 100 });
    expect(layout.fixedLabel!.y).toBeLessThan(0);
    expect(layout.coordinates!.y).toBeGreaterThan(0);
    expect(layout.fixedLabel).not.toHaveProperty('fontFamily');
    expect(layout.fixedLabel).not.toHaveProperty('bold');
    expect(layout.fixedLabel).not.toHaveProperty('italic');
  });
});
