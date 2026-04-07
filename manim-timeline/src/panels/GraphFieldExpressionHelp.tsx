/** Native tooltip text for the main section help control. */
export const GRAPH_FIELD_SECTION_HELP =
  'The canvas preview evaluates JavaScript (use Math.sin, Math.cos, Math.exp, etc.). ' +
  'The exported Manim scene uses Python with NumPy (use np.sin, np.cos, np.exp, etc.). ' +
  'Enter the same mathematical formula in both boxes; only the syntax differs. ' +
  'Variables are x and y.';

export const GRAPH_FIELD_JS_HELP =
  'Preview only: JavaScript expression. Examples: Math.sin(x), x*y, Math.exp(-x*x-y*y).';

export const GRAPH_FIELD_PY_HELP =
  'Export only: Python/NumPy expression. Examples: np.sin(x), x*y, np.exp(-x*x-y*y).';

export const SLOPE_FIELD_PRESETS: {
  label: string;
  js: string;
  py: string;
}[] = [
  { label: '0', js: '0', py: '0' },
  { label: 'x', js: 'x', py: 'x' },
  { label: 'y', js: 'y', py: 'y' },
  { label: 'x + y', js: 'x + y', py: 'x + y' },
  { label: 'x · y', js: 'x * y', py: 'x * y' },
  { label: 'sin(x)', js: 'Math.sin(x)', py: 'np.sin(x)' },
  { label: 'cos(y)', js: 'Math.cos(y)', py: 'np.cos(y)' },
  { label: 'e^{−r²}', js: 'Math.exp(-(x*x + y*y))', py: 'np.exp(-(x*x + y*y))' },
];

export const VECTOR_FIELD_PRESETS: {
  label: string;
  jsP: string;
  pyP: string;
  jsQ: string;
  pyQ: string;
}[] = [
  { label: 'Rotate (CCW)', jsP: '-y', pyP: '-y', jsQ: 'x', pyQ: 'x' },
  { label: 'Outward', jsP: 'x', pyP: 'x', jsQ: 'y', pyQ: 'y' },
  { label: 'Inward', jsP: '-x', pyP: '-x', jsQ: '-y', pyQ: '-y' },
  { label: '(1, 0)', jsP: '1', pyP: '1', jsQ: '0', pyQ: '0' },
  {
    label: 'sin(x), cos(y)',
    jsP: 'Math.sin(x)',
    pyP: 'np.sin(x)',
    jsQ: 'Math.cos(y)',
    pyQ: 'np.cos(y)',
  },
];

interface HelpIconProps {
  title: string;
  /** Accessible label when title is long */
  label?: string;
}

/** Small ? control; stops propagation so it does not toggle a parent <details>. */
export function GraphFieldHelpIcon({ title, label = 'Help' }: HelpIconProps) {
  return (
    <button
      type="button"
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-slate-500 text-[10px] font-semibold leading-none text-slate-400 hover:border-slate-400 hover:text-slate-200"
      title={title}
      aria-label={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      ?
    </button>
  );
}

interface PresetButtonsProps {
  presets: { label: string }[];
  onPick: (index: number) => void;
  /** Shown above the buttons */
  hint?: string;
}

export function GraphFieldPresetRow({ presets, onPick, hint }: PresetButtonsProps) {
  return (
    <div className="flex flex-col gap-1">
      {hint ? (
        <span className="text-[10px] text-slate-500">{hint}</span>
      ) : null}
      <div className="flex flex-wrap gap-1">
        {presets.map((p, i) => (
          <button
            key={p.label}
            type="button"
            title={`Insert: ${p.label}`}
            className="rounded border border-slate-600 bg-slate-800/80 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 hover:bg-slate-700"
            onClick={(e) => {
              e.stopPropagation();
              onPick(i);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
