import { useCallback, type MutableRefObject, type RefObject } from 'react';
import { GraphFieldPresetRow } from './GraphFieldExpressionHelp';

export const GRAPH_PLOT_SECTION_HELP =
  'The canvas preview evaluates JavaScript (Math.sin, Math.pow, …). ' +
  'Export uses Python with NumPy (np.sin, np.power, …). ' +
  'Use the same math in both boxes; only the syntax differs. Variable: x.';

export const GRAPH_PLOT_JS_HELP =
  'Preview: JavaScript expression in x. Examples: Math.sin(x), x**2, Math.exp(-x*x).';

export const GRAPH_PLOT_PY_HELP =
  'Export: Python/NumPy expression in x. Examples: np.sin(x), x**2, np.exp(-x*x).';

/** Full replace — sets both preview and export expressions. */
export const GRAPH_PLOT_FORMULA_PRESETS: { label: string; js: string; py: string }[] = [
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

/** Insert at caret in each box (paired JS / Python). */
export const GRAPH_PLOT_INSERT_SNIPPETS: { label: string; js: string; py: string }[] = [
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

function applyDualInsert(
  jsExpr: string,
  pyExpr: string,
  jsEl: HTMLInputElement | null,
  pyEl: HTMLInputElement | null,
  jsIns: string,
  pyIns: string,
): { jsExpr: string; pyExpr: string; jsSel: number; pySel: number } {
  const ins = (cur: string, el: HTMLInputElement | null, snip: string) => {
    if (!el) {
      const pos = cur.length + snip.length;
      return { next: cur + snip, pos };
    }
    const a = el.selectionStart ?? cur.length;
    const b = el.selectionEnd ?? a;
    return { next: cur.slice(0, a) + snip + cur.slice(b), pos: a + snip.length };
  };
  const rj = ins(jsExpr, jsEl, jsIns);
  const rp = ins(pyExpr, pyEl, pyIns);
  return { jsExpr: rj.next, pyExpr: rp.next, jsSel: rj.pos, pySel: rp.pos };
}

interface GraphPlotExprAssistProps {
  jsExpr: string;
  pyExpr: string;
  patchFn: (p: { jsExpr: string; pyExpr: string }) => void;
  jsInputRef: RefObject<HTMLInputElement | null>;
  pyInputRef: RefObject<HTMLInputElement | null>;
  /** Which formula box was focused last (restored after snippet insert). */
  lastFocusRef: MutableRefObject<'js' | 'py'>;
}

export function GraphPlotExprAssist({
  jsExpr,
  pyExpr,
  patchFn,
  jsInputRef,
  pyInputRef,
  lastFocusRef,
}: GraphPlotExprAssistProps) {
  const onInsertSnippet = useCallback(
    (jsIns: string, pyIns: string) => {
      const { jsExpr: j, pyExpr: p, jsSel, pySel } = applyDualInsert(
        jsExpr,
        pyExpr,
        jsInputRef.current,
        pyInputRef.current,
        jsIns,
        pyIns,
      );
      patchFn({ jsExpr: j, pyExpr: p });
      requestAnimationFrame(() => {
        const je = jsInputRef.current;
        const pe = pyInputRef.current;
        if (je) {
          je.setSelectionRange(jsSel, jsSel);
        }
        if (pe) {
          pe.setSelectionRange(pySel, pySel);
        }
        if (lastFocusRef.current === 'js' && je) {
          je.focus();
        } else if (pe) {
          pe.focus();
        }
      });
    },
    [jsExpr, pyExpr, patchFn, jsInputRef, pyInputRef, lastFocusRef],
  );

  return (
    <div className="flex flex-col gap-2 mt-1">
      <GraphFieldPresetRow
        hint="Whole formula (replaces both boxes):"
        presets={GRAPH_PLOT_FORMULA_PRESETS}
        onPick={(i) => {
          const row = GRAPH_PLOT_FORMULA_PRESETS[i]!;
          patchFn({ jsExpr: row.js, pyExpr: row.py });
        }}
      />
      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-slate-500">
          Insert at cursor (updates preview + export together):
        </span>
        <div className="flex flex-wrap gap-1">
          {GRAPH_PLOT_INSERT_SNIPPETS.map((s) => (
            <button
              key={s.label}
              type="button"
              title={`Insert ${s.js} / ${s.py}`}
              className="rounded border border-slate-600 bg-slate-800/80 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 hover:bg-slate-700"
              onClick={() => onInsertSnippet(s.js, s.py)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
