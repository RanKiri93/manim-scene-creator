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
      <span className="inline-flex items-center gap-1 text-meta text-kind-axes">
        <span aria-hidden>✓</span> Expressions look valid
      </span>
    ) : (
      <span
        className={
          status.level === 'error'
            ? 'text-meta text-danger'
            : 'text-meta text-warn'
        }
      >
        {status.level === 'error' ? '✕' : '!'} {firstIssue?.message}
        {status.issues.length > 1
          ? ` (+${status.issues.length - 1} more — open helper)`
          : ''}
      </span>
    );

  return (
    <div dir="ltr" className="rounded-ctl border border-rule bg-ink/40 px-2 py-2 text-left">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-ctl text-chalk-dim">{label}</span>
        <GraphFieldHelpIcon title={sectionHelp} label={`Help: ${label}`} />
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setHelperOpen(true)}
          className="rounded-ctl border border-rule bg-raised px-2 py-0.5 text-meta text-chalk hover:border-rule hover:bg-rule"
        >
          Open helper
        </button>
      </div>
      <p className="mt-1 text-meta leading-snug text-chalk-faint">
        JavaScript drives the canvas preview; Python (NumPy) drives export.
        Variable{variables.length === 1 ? ' is' : 's are'}{' '}
        {variables.map((v, i) => (
          <span key={v}>
            {i > 0 ? ', ' : ''}
            <code className="text-chalk-dim">{v}</code>
          </span>
        ))}
        .
      </p>
      <div className="mt-2 flex items-center gap-1 text-ctl text-chalk-dim">
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
        className="mt-0.5 w-full bg-raised border border-rule rounded-ctl px-2 py-1 text-ctl text-chalk font-mono text-left"
      />
      <div className="mt-2 flex items-center gap-1 text-ctl text-chalk-dim">
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
        className="mt-0.5 w-full bg-raised border border-rule rounded-ctl px-2 py-1 text-ctl text-chalk font-mono text-left"
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
            className="rounded-ctl border border-warn/45 bg-warn/10 px-1.5 py-0.5 text-meta text-warn hover:bg-warn/10"
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
