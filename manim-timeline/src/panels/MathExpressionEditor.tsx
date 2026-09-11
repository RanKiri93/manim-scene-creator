import { useMemo, useState } from 'react';
import {
  replacePowerOperator,
  validateMathExpressionPair,
} from '@/lib/mathExpressionValidation';
import { GraphFieldHelpIcon } from './GraphFieldExpressionHelp';
import MathExpressionDialog from './MathExpressionDialog';
import type { MathExpressionProfile } from './mathExpressionPresets';
import {
  SCALAR_X_FORMULA_PRESETS,
  SCALAR_X_INSERT_SNIPPETS,
  SCALAR_X_JS_HELP,
  SCALAR_X_PY_HELP,
  SCALAR_X_SECTION_HELP,
} from './mathExpressionPresets';

interface MathExpressionEditorProps {
  /** Section heading, e.g. "Function formulae". */
  label: string;
  jsExpr: string;
  pyExpr: string;
  onChange: (p: { jsExpr: string; pyExpr: string }) => void;
  /**
   * Context profile (variables, help copy, presets/snippets). When omitted
   * the scalar `f(x)` defaults below apply (Plot + Area call sites).
   */
  profile?: MathExpressionProfile;
  variables?: string[];
  sectionHelp?: string;
  jsHelp?: string;
  pyHelp?: string;
  jsPlaceholder?: string;
  pyPlaceholder?: string;
  dialogTitle?: string;
}

/** Fallback variable context (scalar `f(x)`); module-level so hooks deps stay stable. */
const DEFAULT_VARIABLES = ['x'];

/**
 * Compact paired expression control for one JS/Python expression pair.
 * Two explicit boxes (JS preview + Python export), an inline status row,
 * a one-click `^` fix, and an "Open helper" modal for larger edits.
 * Presentation only: all state lives in the parent via `onChange`.
 */
export default function MathExpressionEditor({
  label,
  jsExpr,
  pyExpr,
  onChange,
  profile,
  variables: variablesProp,
  sectionHelp: sectionHelpProp,
  jsHelp: jsHelpProp,
  pyHelp: pyHelpProp,
  jsPlaceholder: jsPlaceholderProp,
  pyPlaceholder: pyPlaceholderProp,
  dialogTitle = 'Expression helper',
}: MathExpressionEditorProps) {
  const [helperOpen, setHelperOpen] = useState(false);

  const variables = variablesProp ?? profile?.variables ?? DEFAULT_VARIABLES;
  const sectionHelp =
    sectionHelpProp ?? profile?.sectionHelp ?? SCALAR_X_SECTION_HELP;
  const jsHelp = jsHelpProp ?? profile?.jsHelp ?? SCALAR_X_JS_HELP;
  const pyHelp = pyHelpProp ?? profile?.pyHelp ?? SCALAR_X_PY_HELP;
  const jsPlaceholder =
    jsPlaceholderProp ?? profile?.jsPlaceholder ?? 'JS: Math.sin(x)';
  const pyPlaceholder =
    pyPlaceholderProp ?? profile?.pyPlaceholder ?? 'Python: np.sin(x)';
  const presets = profile?.presets ?? SCALAR_X_FORMULA_PRESETS;
  const snippets = profile?.snippets ?? SCALAR_X_INSERT_SNIPPETS;

  const status = useMemo(
    () =>
      validateMathExpressionPair({
        jsExpr,
        pyExpr,
        variables,
      }),
    [jsExpr, pyExpr, variables],
  );

  const firstIssue = status.issues[0];
  const statusBadge =
    status.level === 'ok' ? (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300">
        <span aria-hidden>✓</span> Expressions look valid
      </span>
    ) : (
      <span
        className={
          status.level === 'error'
            ? 'text-[11px] text-red-300'
            : 'text-[11px] text-amber-300'
        }
      >
        {status.level === 'error' ? '✕' : '!'} {firstIssue?.message}
        {status.issues.length > 1
          ? ` (+${status.issues.length - 1} more — open helper)`
          : ''}
      </span>
    );

  return (
    <div dir="ltr" className="rounded border border-slate-600 bg-slate-800/30 px-2 py-2 text-left">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-xs text-slate-400">{label}</span>
        <GraphFieldHelpIcon title={sectionHelp} label={`Help: ${label}`} />
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setHelperOpen(true)}
          className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-[11px] text-slate-200 hover:border-slate-500 hover:bg-slate-700"
        >
          Open helper
        </button>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-slate-500">
        JavaScript drives the canvas preview; Python (NumPy) drives export.
        Variable{variables.length === 1 ? ' is' : 's are'}{' '}
        {variables.map((v, i) => (
          <span key={v}>
            {i > 0 ? ', ' : ''}
            <code className="text-slate-400">{v}</code>
          </span>
        ))}
        .
      </p>
      <div className="mt-2 flex items-center gap-1 text-xs text-slate-400">
        <span>Preview (JavaScript)</span>
        <GraphFieldHelpIcon title={jsHelp} label="Help: JavaScript formula" />
      </div>
      <input
        type="text"
        value={jsExpr}
        onChange={(e) => onChange({ jsExpr: e.target.value, pyExpr })}
        placeholder={jsPlaceholder}
        spellCheck={false}
        dir="ltr"
        className="mt-0.5 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono text-left"
      />
      <div className="mt-2 flex items-center gap-1 text-xs text-slate-400">
        <span>Export (Python)</span>
        <GraphFieldHelpIcon title={pyHelp} label="Help: Python formula" />
      </div>
      <input
        type="text"
        value={pyExpr}
        onChange={(e) => onChange({ jsExpr, pyExpr: e.target.value })}
        placeholder={pyPlaceholder}
        spellCheck={false}
        dir="ltr"
        className="mt-0.5 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono text-left"
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {statusBadge}
        {status.hasPowerCaret && (
          <button
            type="button"
            onClick={() =>
              onChange({
                jsExpr: replacePowerOperator(jsExpr),
                pyExpr: replacePowerOperator(pyExpr),
              })
            }
            className="rounded border border-amber-600 bg-amber-900/40 px-1.5 py-0.5 text-[10px] text-amber-200 hover:bg-amber-800/50"
          >
            Fix: ^ → **
          </button>
        )}
      </div>
      {helperOpen && (
        <MathExpressionDialog
          title={dialogTitle}
          sectionHelp={sectionHelp}
          jsHelp={jsHelp}
          pyHelp={pyHelp}
          jsExpr={jsExpr}
          pyExpr={pyExpr}
          variables={variables}
          presets={presets}
          snippets={snippets}
          onApply={(p) => {
            onChange(p);
            setHelperOpen(false);
          }}
          onClose={() => setHelperOpen(false)}
        />
      )}
    </div>
  );
}
