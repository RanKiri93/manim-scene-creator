import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { SectionLabel, focusRing } from '@/components/ui';
import type { ShapeDrawPreset } from '@/lib/shapeDraw';

/**
 * Shapes the picker offers, in sections. Each tile starts drawing on the canvas. Presets set
 * extra fields (a triangle is a 3-sided regular polygon, a rounded rectangle has corners).
 * Icons follow the Insert rail grammar: 20px grid, 1.5px round strokes, fill only for areas.
 */
interface ShapePresetDef {
  id: string;
  preset: ShapeDrawPreset;
  icon: ReactNode;
}

const area = { fill: 'currentColor', fillOpacity: 0.3 } as const;

const SECTIONS: readonly { label: string; presets: readonly ShapePresetDef[] }[] = [
  {
    label: 'Basic',
    presets: [
      { id: 'circle', preset: { shapeType: 'circle', label: 'Circle' }, icon: <circle cx="10" cy="10" r="6.5" /> },
      { id: 'ellipse', preset: { shapeType: 'ellipse', label: 'Ellipse' }, icon: <ellipse cx="10" cy="10" rx="7.5" ry="4.5" /> },
      { id: 'rectangle', preset: { shapeType: 'rectangle', label: 'Rectangle' }, icon: <rect x="3" y="5.5" width="14" height="9" /> },
      {
        id: 'roundedRectangle',
        preset: { shapeType: 'rectangle', label: 'Rounded rectangle', patch: { cornerRadius: 0.25 } },
        icon: <rect x="3" y="5.5" width="14" height="9" rx="3" />,
      },
      {
        id: 'triangle',
        preset: { shapeType: 'regularPolygon', label: 'Triangle', patch: { sides: 3 } },
        icon: <path d="M10 3.5L17 15.5H3z" />,
      },
      {
        id: 'regularPolygon',
        preset: { shapeType: 'regularPolygon', label: 'Regular polygon', patch: { sides: 6 } },
        icon: <path d="M6.5 16h7l3.5-6-3.5-6h-7L3 10z" />,
      },
      { id: 'polygon', preset: { shapeType: 'polygon', label: 'Polygon' }, icon: <path d="M3.5 14.5l3-10 8 2.5 2 8.5z" /> },
    ],
  },
  {
    label: 'Lines',
    presets: [
      { id: 'line', preset: { shapeType: 'line', label: 'Line' }, icon: <path d="M4 16L16 4" /> },
      {
        id: 'dashedLine',
        preset: { shapeType: 'line', label: 'Dashed line', patch: { lineStyle: 'dashed' } },
        icon: <path d="M4 16L16 4" strokeDasharray="2.6 2.4" />,
      },
      { id: 'arrow', preset: { shapeType: 'arrow', label: 'Arrow' }, icon: <path d="M4 16L16 4M9.5 4H16v6.5" /> },
      {
        id: 'doubleArrow',
        preset: { shapeType: 'doubleArrow', label: 'Double arrow' },
        icon: <path d="M4 16L16 4M9.5 4H16v6.5M4 9.5V16h6.5" />,
      },
      {
        // Negative bend: a left-to-right arrow arcs over the top.
        id: 'curvedArrow',
        preset: { shapeType: 'curvedArrow', label: 'Curved arrow', patch: { arcAngleDeg: -60 } },
        icon: <path d="M3 15.5C4.5 8 11 4.5 16 8.5M15 5.1l1 3.4-3.5-.2" />,
      },
      { id: 'polyline', preset: { shapeType: 'polyline', label: 'Polyline' }, icon: <path d="M3 15l4.5-8 4 5 5.5-8" /> },
    ],
  },
  {
    label: 'Arcs',
    presets: [
      { id: 'arc', preset: { shapeType: 'arc', label: 'Arc' }, icon: <path d="M15.6 13.2A6.5 6.5 0 1 1 13.2 4.4" /> },
      { id: 'sector', preset: { shapeType: 'sector', label: 'Sector' }, icon: <path d="M10 10V3.5A6.5 6.5 0 0 1 16.5 10z" {...area} /> },
      {
        id: 'annulus',
        preset: { shapeType: 'annulus', label: 'Ring' },
        icon: (
          <>
            <circle cx="10" cy="10" r="7" />
            <circle cx="10" cy="10" r="3.5" />
          </>
        ),
      },
    ],
  },
  {
    label: 'Marks',
    presets: [
      {
        id: 'brace',
        preset: { shapeType: 'brace', label: 'Brace' },
        icon: <path d="M3 6.5c0 1.8.8 2.6 2.6 2.6h2c1.4 0 2.1.7 2.4 2.4.3-1.7 1-2.4 2.4-2.4h2c1.8 0 2.6-.8 2.6-2.6" />,
      },
    ],
  },
];

function ShapeIcon({ children }: { children: ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

/** Tiles for every shape; picking one starts drawing it on the canvas. */
export default function ShapePicker({ onPick }: { onPick: (preset: ShapeDrawPreset) => void }) {
  return (
    <div className="flex flex-col gap-1">
      {SECTIONS.map((section) => (
        <div key={section.label}>
          <SectionLabel className="mt-1 mb-0.5 px-1">{section.label}</SectionLabel>
          <div className="grid grid-cols-3 gap-0.5">
            {section.presets.map((p) => (
              <button
                key={p.id}
                type="button"
                title={`Draw a ${p.preset.label.toLowerCase()} on the canvas`}
                onClick={() => onPick(p.preset)}
                className={cx(
                  'flex min-h-14 flex-col items-center justify-center gap-1 rounded-ctl px-0.5 py-1.5 text-meta leading-tight text-chalk-dim hover:bg-raised hover:text-chalk',
                  focusRing,
                )}
              >
                <ShapeIcon>{p.icon}</ShapeIcon>
                <span className="max-w-full text-center">{p.preset.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
