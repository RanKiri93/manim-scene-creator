import type { GraphDot } from '@/types/scene';

export interface GraphTextAnnotationSpec {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  fill: string;
  align: 'left' | 'center' | 'right';
  direction: 'rtl' | 'ltr';
}

export interface GraphAnnotationLayout {
  fixedLabel: GraphTextAnnotationSpec | null;
  coordinates: GraphTextAnnotationSpec | null;
  coordinateText: string | null;
}

function directionVector(direction: NonNullable<GraphDot['labelDir']>): { x: number; y: number } {
  switch (direction) {
    case 'UP': return { x: 0, y: -1 };
    case 'DOWN': return { x: 0, y: 1 };
    case 'LEFT': return { x: -1, y: 0 };
    case 'RIGHT': return { x: 1, y: 0 };
    case 'UL': return { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };
    case 'UR': return { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
    case 'DL': return { x: -Math.SQRT1_2, y: Math.SQRT1_2 };
    case 'DR': return { x: Math.SQRT1_2, y: Math.SQRT1_2 };
  }
}

function annotation(text: string, direction: GraphDot['labelDir'], args: {
  point: { x: number; y: number };
  radiusPx: number;
  fontPx: number;
  spacingPx: number;
  fill: string;
  direction: 'rtl' | 'ltr';
}): GraphTextAnnotationSpec {
  const vector = directionVector(direction);
  const width = Math.max(args.fontPx * 0.6, text.length * args.fontPx * 0.55);
  const height = args.fontPx;
  const distance = args.radiusPx + args.spacingPx;
  const cx = args.point.x + vector.x * distance;
  const cy = args.point.y + vector.y * distance;
  const align = args.direction === 'rtl' ? 'right' : vector.x < -0.25 ? 'right' : vector.x > 0.25 ? 'left' : 'center';
  return { text, x: cx - width / 2, y: cy - height / 2, width, fontSize: args.fontPx, fill: args.fill, align, direction: args.direction };
}

/** Compute graph-dot text placement/styles in canvas pixels; geometry is shared with canvas and later codegen. */
export function buildGraphAnnotationLayout(args: {
  dot: GraphDot;
  point: { x: number; y: number };
  coordinate: { x: number; y: number };
  radiusPx: number;
  pxPerUnit: number;
}): GraphAnnotationLayout {
  const { dot, point, coordinate, radiusPx, pxPerUnit } = args;
  const labelFontSize = Number.isFinite(dot.labelFontSize) ? dot.labelFontSize! : 18;
  const coordinateFontSize = Number.isFinite(dot.coordinateFontSize) ? dot.coordinateFontSize! : 18;
  const labelFont = Math.max(1, labelFontSize * pxPerUnit / 180);
  const coordFont = Math.max(1, coordinateFontSize * pxPerUnit / 180);
  const labelDirection = dot.labelDir ?? 'UP';
  const coordinateDirection = dot.coordinateDir ?? opposite(labelDirection);
  const precision = Number.isFinite(dot.coordinatePrecision)
    ? Math.max(0, Math.min(6, Math.trunc(dot.coordinatePrecision!)))
    : 2;
  const labelSpacing = Number.isFinite(dot.labelSpacing) ? dot.labelSpacing! : 0.15;
  const coordinateSpacing = Number.isFinite(dot.coordinateSpacing) ? dot.coordinateSpacing! : 0.15;
  const coordinateText = dot.showCoordinates === true
    ? `(${coordinate.x.toFixed(precision)}, ${coordinate.y.toFixed(precision)})`
    : null;
  const fixedLabel = dot.label.trim()
    ? annotation(dot.label.trim(), labelDirection, {
        point, radiusPx, fontPx: labelFont,
        spacingPx: Math.max(0, labelSpacing) * pxPerUnit,
        fill: dot.labelColor ?? '#ffffff',
        direction: 'rtl',
      })
    : null;
  const coordinates = coordinateText
    ? annotation(coordinateText, coordinateDirection, {
        point, radiusPx, fontPx: coordFont,
        spacingPx: Math.max(0, coordinateSpacing) * pxPerUnit,
        fill: dot.coordinateColor ?? '#e2e8f0',
        direction: 'ltr',
      })
    : null;
  return { fixedLabel, coordinates, coordinateText };
}

function opposite(direction: GraphDot['labelDir']): NonNullable<GraphDot['labelDir']> {
  const opposites = { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT', UL: 'DR', UR: 'DL', DL: 'UR', DR: 'UL' } as const;
  return opposites[direction ?? 'UP'];
}
