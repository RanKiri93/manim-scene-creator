/**
 * Shared preset/snippet catalogs for every paired JS/Python expression
 * editor (plots, areas, curves, fields, series, sequences, path offsets).
 * The scalar `f(x)` tables moved (not reinvented) from the old
 * GraphPlotExpressionHelp. Each entry carries both dialects so snippet
 * insertion always updates preview + export together.
 */

export interface MathExpressionPreset {
  label: string;
  js: string;
  py: string;
}

export const SCALAR_X_SECTION_HELP =
  'The canvas preview evaluates JavaScript (Math.sin, Math.pow, …). ' +
  'Export uses Python with NumPy (np.sin, np.power, …). ' +
  'Use the same math in both boxes; only the syntax differs. Variable: x.';

export const SCALAR_X_JS_HELP =
  'Preview: JavaScript expression in x. Examples: Math.sin(x), x**2, Math.exp(-x*x).';

export const SCALAR_X_PY_HELP =
  'Export: Python/NumPy expression in x. Examples: np.sin(x), x**2, np.exp(-x*x).';

/** Full replace — sets both preview and export expressions. */
export const SCALAR_X_FORMULA_PRESETS: MathExpressionPreset[] = [
  { label: 'x', js: 'x', py: 'x' },
  { label: 'x²', js: 'x**2', py: 'x**2' },
  { label: 'x³', js: 'x**3', py: 'x**3' },
  { label: 'sin(x)', js: 'Math.sin(x)', py: 'np.sin(x)' },
  { label: 'cos(x)', js: 'Math.cos(x)', py: 'np.cos(x)' },
  { label: 'tan(x)', js: 'Math.tan(x)', py: 'np.tan(x)' },
  { label: 'exp(x)', js: 'Math.exp(x)', py: 'np.exp(x)' },
  { label: 'ln(x)', js: 'Math.log(x)', py: 'np.log(x)' },
  { label: '√x', js: 'Math.sqrt(x)', py: 'np.sqrt(x)' },
  { label: '|x|', js: 'Math.abs(x)', py: 'np.abs(x)' },
  { label: '1/x', js: '1/x', py: '1/x' },
  { label: 'sin(πx)', js: 'Math.sin(Math.PI * x)', py: 'np.sin(np.pi * x)' },
  { label: 'cos(πx)', js: 'Math.cos(Math.PI * x)', py: 'np.cos(np.pi * x)' },
  { label: 'e^{−x²}', js: 'Math.exp(-(x*x))', py: 'np.exp(-(x*x))' },
  { label: 'x·sin(x)', js: 'x * Math.sin(x)', py: 'x * np.sin(x)' },
  { label: 'x·e^{−x}', js: 'x * Math.exp(-x)', py: 'x * np.exp(-x)' },
];

/**
 * One expression context: variable chips, help copy, and the paired
 * preset/snippet catalogs the inline editor and modal helper render.
 * Each entry always carries both dialects so preview + export stay in sync.
 */
export interface MathExpressionProfile {
  variables: string[];
  sectionHelp: string;
  jsHelp: string;
  pyHelp: string;
  jsPlaceholder: string;
  pyPlaceholder: string;
  presets: MathExpressionPreset[];
  snippets: MathExpressionPreset[];
}

/** Parametric coordinate `x(t)` / `y(t)` — graph curves. */
export const PARAM_T_PRESETS: MathExpressionPreset[] = [
  { label: 't', js: 't', py: 't' },
  { label: 'cos(t)', js: 'Math.cos(t)', py: 'np.cos(t)' },
  { label: 'sin(t)', js: 'Math.sin(t)', py: 'np.sin(t)' },
  { label: 't²', js: 't**2', py: 't**2' },
  { label: 'cos(2t)', js: 'Math.cos(2*t)', py: 'np.cos(2*t)' },
  { label: 'sin(2t)', js: 'Math.sin(2*t)', py: 'np.sin(2*t)' },
  { label: 'eᵗ', js: 'Math.exp(t)', py: 'np.exp(t)' },
  { label: '1', js: '1', py: '1' },
];

export const PARAM_T_SNIPPETS: MathExpressionPreset[] = [
  { label: 'π', js: 'Math.PI', py: 'np.pi' },
  { label: 'e', js: 'Math.E', py: 'np.e' },
  { label: 'sin(', js: 'Math.sin(', py: 'np.sin(' },
  { label: 'cos(', js: 'Math.cos(', py: 'np.cos(' },
  { label: 'tan(', js: 'Math.tan(', py: 'np.tan(' },
  { label: 'exp(', js: 'Math.exp(', py: 'np.exp(' },
  { label: 'ln(', js: 'Math.log(', py: 'np.log(' },
  { label: '√(', js: 'Math.sqrt(', py: 'np.sqrt(' },
  { label: '|·|', js: 'Math.abs(', py: 'np.abs(' },
  { label: 't', js: 't', py: 't' },
  { label: '**2', js: '**2', py: '**2' },
  { label: '**', js: '**', py: '**' },
  { label: '( )', js: '()', py: '()' },
];

export const PARAM_T_PROFILE: MathExpressionProfile = {
  variables: ['t'],
  sectionHelp:
    'The canvas preview evaluates JavaScript (Math.sin, Math.cos, …). ' +
    'Export uses Python with NumPy (np.sin, np.cos, …). ' +
    'Use the same math in both boxes; only the syntax differs. Variable: t.',
  jsHelp: 'Preview: JavaScript expression in t. Examples: Math.cos(t), t**2.',
  pyHelp: 'Export: Python/NumPy expression in t. Examples: np.cos(t), t**2.',
  jsPlaceholder: 'JS: Math.cos(t)',
  pyPlaceholder: 'Python: np.cos(t)',
  presets: PARAM_T_PRESETS,
  snippets: PARAM_T_SNIPPETS,
};

/** Scalar field `f(x, y)` — slope fields and one vector component. */
export const FIELD_XY_PRESETS: MathExpressionPreset[] = [
  { label: '0', js: '0', py: '0' },
  { label: 'x', js: 'x', py: 'x' },
  { label: 'y', js: 'y', py: 'y' },
  { label: 'x + y', js: 'x + y', py: 'x + y' },
  { label: 'x · y', js: 'x * y', py: 'x * y' },
  { label: '−y', js: '-y', py: '-y' },
  { label: 'sin(x)', js: 'Math.sin(x)', py: 'np.sin(x)' },
  { label: 'cos(y)', js: 'Math.cos(y)', py: 'np.cos(y)' },
  { label: 'e^{−r²}', js: 'Math.exp(-(x*x + y*y))', py: 'np.exp(-(x*x + y*y))' },
];

export const FIELD_XY_SNIPPETS: MathExpressionPreset[] = [
  { label: 'sin(', js: 'Math.sin(', py: 'np.sin(' },
  { label: 'cos(', js: 'Math.cos(', py: 'np.cos(' },
  { label: 'exp(', js: 'Math.exp(', py: 'np.exp(' },
  { label: 'ln(', js: 'Math.log(', py: 'np.log(' },
  { label: '√(', js: 'Math.sqrt(', py: 'np.sqrt(' },
  { label: '|·|', js: 'Math.abs(', py: 'np.abs(' },
  { label: 'x', js: 'x', py: 'x' },
  { label: 'y', js: 'y', py: 'y' },
  { label: '**2', js: '**2', py: '**2' },
  { label: '**', js: '**', py: '**' },
  { label: '( )', js: '()', py: '()' },
];

export const FIELD_XY_PROFILE: MathExpressionProfile = {
  variables: ['x', 'y'],
  sectionHelp:
    'The canvas preview evaluates JavaScript (Math.sin, Math.cos, …). ' +
    'Export uses Python with NumPy (np.sin, np.cos, …). ' +
    'Use the same math in both boxes; only the syntax differs. Variables: x and y.',
  jsHelp:
    'Preview: JavaScript expression in x, y. Examples: Math.sin(x), x*y.',
  pyHelp: 'Export: Python/NumPy expression in x, y. Examples: np.sin(x), x*y.',
  jsPlaceholder: 'JS: x + y',
  pyPlaceholder: 'Python: x + y',
  presets: FIELD_XY_PRESETS,
  snippets: FIELD_XY_SNIPPETS,
};

/** Paired vector-field preset: sets P and Q (JS + Python) together. */
export interface VectorFieldPreset {
  label: string;
  jsP: string;
  pyP: string;
  jsQ: string;
  pyQ: string;
}

/** Whole-field replace — kept at the field-editor level (one pair per helper). */
export const VECTOR_XY_PRESETS: VectorFieldPreset[] = [
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

/** Function-series term `f(n, x)` over integer `n`. */
export const SERIES_NX_PRESETS: MathExpressionPreset[] = [
  { label: 'sin(nx)/n', js: 'Math.sin(n*x)/n', py: 'np.sin(n*x)/n' },
  { label: 'cos(nx)', js: 'Math.cos(n*x)', py: 'np.cos(n*x)' },
  { label: 'sin(nx)', js: 'Math.sin(n*x)', py: 'np.sin(n*x)' },
  { label: 'xⁿ', js: 'x**n', py: 'x**n' },
  { label: 'xⁿ/n', js: 'x**n/n', py: 'x**n/n' },
  { label: 'sin(nπx)', js: 'Math.sin(n*Math.PI*x)', py: 'np.sin(n*np.pi*x)' },
  { label: 'cos(nπx)', js: 'Math.cos(n*Math.PI*x)', py: 'np.cos(n*np.pi*x)' },
];

export const SERIES_NX_SNIPPETS: MathExpressionPreset[] = [
  { label: 'n', js: 'n', py: 'n' },
  { label: 'x', js: 'x', py: 'x' },
  { label: 'π', js: 'Math.PI', py: 'np.pi' },
  { label: 'sin(', js: 'Math.sin(', py: 'np.sin(' },
  { label: 'cos(', js: 'Math.cos(', py: 'np.cos(' },
  { label: 'exp(', js: 'Math.exp(', py: 'np.exp(' },
  { label: '**n', js: '**n', py: '**n' },
  { label: '**', js: '**', py: '**' },
  { label: '( )', js: '()', py: '()' },
];

export const SERIES_NX_PROFILE: MathExpressionProfile = {
  variables: ['n', 'x'],
  sectionHelp:
    'The canvas preview evaluates JavaScript (Math.sin, Math.cos, …). ' +
    'Export uses Python with NumPy (np.sin, np.cos, …). ' +
    'Use the same math in both boxes; only the syntax differs. ' +
    'Variables: n (integer index) and x.',
  jsHelp:
    'Preview: JavaScript expression in n, x. Example: Math.sin(n * x) / n.',
  pyHelp: 'Export: Python/NumPy expression in n, x. Example: np.sin(n * x) / n.',
  jsPlaceholder: 'JS: Math.sin(n * x)',
  pyPlaceholder: 'Python: np.sin(n * x)',
  presets: SERIES_NX_PRESETS,
  snippets: SERIES_NX_SNIPPETS,
};

/** Point-sequence coordinate `x(n)` / `y(n)` over integer `n`. */
export const SEQ_N_PRESETS: MathExpressionPreset[] = [
  { label: 'n', js: 'n', py: 'n' },
  { label: '0', js: '0', py: '0' },
  { label: '1', js: '1', py: '1' },
  { label: '−n', js: '-n', py: '-n' },
  { label: 'n²', js: 'n**2', py: 'n**2' },
  { label: 'sin(n)', js: 'Math.sin(n)', py: 'np.sin(n)' },
  { label: 'cos(n)', js: 'Math.cos(n)', py: 'np.cos(n)' },
];

export const SEQ_N_SNIPPETS: MathExpressionPreset[] = [
  { label: 'n', js: 'n', py: 'n' },
  { label: 'π', js: 'Math.PI', py: 'np.pi' },
  { label: 'sin(', js: 'Math.sin(', py: 'np.sin(' },
  { label: 'cos(', js: 'Math.cos(', py: 'np.cos(' },
  { label: '**2', js: '**2', py: '**2' },
  { label: '**', js: '**', py: '**' },
  { label: '( )', js: '()', py: '()' },
];

export const SEQ_N_PROFILE: MathExpressionProfile = {
  variables: ['n'],
  sectionHelp:
    'The canvas preview evaluates JavaScript (Math.sin, Math.cos, …). ' +
    'Export uses Python with NumPy (np.sin, np.cos, …). ' +
    'Use the same math in both boxes; only the syntax differs. Variable: n (integer index).',
  jsHelp: 'Preview: JavaScript expression in n. Example: n.',
  pyHelp: 'Export: Python/NumPy expression in n. Example: n.',
  jsPlaceholder: 'JS: n',
  pyPlaceholder: 'Python: n',
  presets: SEQ_N_PRESETS,
  snippets: SEQ_N_SNIPPETS,
};

/** Target-animation path offset `x(t)` / `y(t)` — same vocabulary as curves. */
export const PATH_T_PROFILE: MathExpressionProfile = {
  variables: ['t'],
  sectionHelp:
    'Path offsets: JavaScript drives the canvas preview, Python (NumPy) drives export. ' +
    'Use the same math in both boxes; only the syntax differs. ' +
    'Variable: t. Values are offsets — the first sample is subtracted automatically.',
  jsHelp: 'Preview: JavaScript offset in t. Example: Math.cos(t).',
  pyHelp: 'Export: Python/NumPy offset in t. Example: np.cos(t).',
  jsPlaceholder: 'JS: Math.cos(t)',
  pyPlaceholder: 'Python: np.cos(t)',
  presets: PARAM_T_PRESETS,
  snippets: PARAM_T_SNIPPETS,
};

/** Insert at caret in each box (paired JS / Python). */
export const SCALAR_X_INSERT_SNIPPETS: MathExpressionPreset[] = [
  { label: 'π', js: 'Math.PI', py: 'np.pi' },
  { label: 'e', js: 'Math.E', py: 'np.e' },
  { label: 'sin(', js: 'Math.sin(', py: 'np.sin(' },
  { label: 'cos(', js: 'Math.cos(', py: 'np.cos(' },
  { label: 'tan(', js: 'Math.tan(', py: 'np.tan(' },
  { label: 'asin(', js: 'Math.asin(', py: 'np.arcsin(' },
  { label: 'acos(', js: 'Math.acos(', py: 'np.arccos(' },
  { label: 'atan(', js: 'Math.atan(', py: 'np.arctan(' },
  { label: 'sinh(', js: 'Math.sinh(', py: 'np.sinh(' },
  { label: 'cosh(', js: 'Math.cosh(', py: 'np.cosh(' },
  { label: 'exp(', js: 'Math.exp(', py: 'np.exp(' },
  { label: 'ln(', js: 'Math.log(', py: 'np.log(' },
  { label: 'log10(', js: 'Math.log10(', py: 'np.log10(' },
  { label: '√(', js: 'Math.sqrt(', py: 'np.sqrt(' },
  { label: '|·|', js: 'Math.abs(', py: 'np.abs(' },
  { label: 'floor(', js: 'Math.floor(', py: 'np.floor(' },
  { label: 'ceil(', js: 'Math.ceil(', py: 'np.ceil(' },
  { label: 'pow(', js: 'Math.pow(', py: 'np.power(' },
  { label: 'x', js: 'x', py: 'x' },
  { label: '**2', js: '**2', py: '**2' },
  { label: '**3', js: '**3', py: '**3' },
  { label: '**', js: '**', py: '**' },
  { label: '( )', js: '()', py: '()' },
];

/** Scalar `f(x)` context — declared last: references both tables above. */
export const SCALAR_X_PROFILE: MathExpressionProfile = {
  variables: ['x'],
  sectionHelp: SCALAR_X_SECTION_HELP,
  jsHelp: SCALAR_X_JS_HELP,
  pyHelp: SCALAR_X_PY_HELP,
  jsPlaceholder: 'JS: Math.sin(x)',
  pyPlaceholder: 'Python: np.sin(x)',
  presets: SCALAR_X_FORMULA_PRESETS,
  snippets: SCALAR_X_INSERT_SNIPPETS,
};
