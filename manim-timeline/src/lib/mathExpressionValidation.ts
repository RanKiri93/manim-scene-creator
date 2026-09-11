/**
 * Shared math-expression validation for every paired JS/Python expression
 * editor (plots, areas, curves, fields, series, sequences, path offsets).
 *
 * Pure module: no React, no store. Panels use `validateMathExpressionPair` to
 * render inline status; the modal helper reuses the same status plus the
 * pure caret-insertion helpers below.
 *
 * Dialect split (never blurred here):
 * - JS (`jsExpr`) drives the canvas preview and is really compiled with
 *   `new Function` — syntax errors are real errors.
 * - Python (`pyExpr`) drives the Manim export and is NEVER executed here.
 *   Its lint is deliberately conservative: balanced brackets, no JS-only
 *   tokens, and an identifier allowlist. Anything uncertain is at most a
 *   warning — the export is the source of truth for Python.
 */

export type MathExpressionIssueLevel = 'error' | 'warning';

export interface MathExpressionIssue {
  dialect: 'js' | 'py' | 'both';
  level: MathExpressionIssueLevel;
  message: string;
  /** Set when the issue offers the one-click `^` → `**` fix. */
  fix?: 'power';
}

export type MathExpressionStatusLevel = 'ok' | 'warning' | 'error';

export interface MathExpressionPairStatus {
  level: MathExpressionStatusLevel;
  issues: MathExpressionIssue[];
  /** True when either dialect contains `^` (always reported as a warning). */
  hasPowerCaret: boolean;
}

export interface ValidateMathExpressionPairArgs {
  jsExpr: string;
  pyExpr: string;
  /** Allowed bare variable names. Defaults to `['x']` (Plot + Area). */
  variables?: string[];
}

/** Globals that may appear bare in a JS preview expression. */
const JS_ALLOWED_GLOBALS = new Set([
  'Math',
  'Number',
  'Infinity',
  'NaN',
  'undefined',
]);

/** Names that may appear bare in a Python/NumPy export expression. */
const PY_ALLOWED_NAMES = new Set([
  'np',
  'numpy',
  'math',
  'abs',
  'min',
  'max',
  'pow',
  'round',
]);

const IDENTIFIER_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/**
 * Collect bare identifiers: skips property names after a dot
 * (`Math.sin` contributes `Math`, not `sin`; `np.pi` contributes `np`).
 */
function bareIdentifiers(expr: string): string[] {
  const out: string[] = [];
  for (const m of expr.matchAll(IDENTIFIER_RE)) {
    const idx = m.index ?? 0;
    if (idx > 0 && expr[idx - 1] === '.') continue;
    out.push(m[0]!);
  }
  return out;
}

function compileJs(
  jsExpr: string,
  variables: string[],
): string | null {
  try {
    new Function(
      ...variables,
      `"use strict"; return (${jsExpr});`,
    );
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `JS syntax error: ${msg}`;
  }
}

function checkBalanced(expr: string): string | null {
  const stack: string[] = [];
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  for (const ch of expr) {
    if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
    else if (ch === ')' || ch === ']' || ch === '}') {
      const want = pairs[ch]!;
      if (stack.pop() !== want) return `Unbalanced bracket: unexpected "${ch}".`;
    }
  }
  if (stack.length > 0) return 'Unbalanced bracket: missing closing bracket.';
  return null;
}

/**
 * Validate one JS/Python expression pair over the given `variables`.
 * Never throws, never executes Python. `^` is always a non-blocking
 * warning (XOR in both dialects).
 */
export function validateMathExpressionPair({
  jsExpr,
  pyExpr,
  variables = ['x'],
}: ValidateMathExpressionPairArgs): MathExpressionPairStatus {
  const issues: MathExpressionIssue[] = [];
  const js = jsExpr.trim();
  const py = pyExpr.trim();

  if (!js) {
    issues.push({
      dialect: 'js',
      level: 'error',
      message: 'Preview expression is empty.',
    });
  }
  if (!py) {
    issues.push({
      dialect: 'py',
      level: 'error',
      message: 'Export expression is empty.',
    });
  }

  if (js) {
    const syntaxError = compileJs(js, variables);
    if (syntaxError) {
      issues.push({ dialect: 'js', level: 'error', message: syntaxError });
    } else {
      const allowed = new Set([...variables, ...JS_ALLOWED_GLOBALS]);
      const unknown = new Set<string>();
      for (const name of bareIdentifiers(js)) {
        if (!allowed.has(name)) unknown.add(name);
      }
      for (const name of unknown) {
        issues.push({
          dialect: 'js',
          level: 'error',
          message: `Unknown name "${name}" — only ${variables.join(', ')} allowed here.`,
        });
      }
    }
  }

  if (py) {
    const unbalanced = checkBalanced(py);
    if (unbalanced) {
      issues.push({ dialect: 'py', level: 'error', message: unbalanced });
    }
    // JS-isms that are never valid NumPy: strict equality, logical
    // operators, negation-as-operator, and the Math namespace.
    if (/(===|!==|&&|\|\||\bMath\.)/.test(py)) {
      issues.push({
        dialect: 'py',
        level: 'error',
        message:
          'Looks like JavaScript (===, &&, ||, or Math.) — use NumPy syntax (==, np.).',
      });
    }
    const allowed = new Set([...variables, ...PY_ALLOWED_NAMES]);
    const unknown = new Set<string>();
    for (const name of bareIdentifiers(py)) {
      if (!allowed.has(name)) unknown.add(name);
    }
    for (const name of unknown) {
      issues.push({
        dialect: 'py',
        level: 'error',
        message: `Unknown name "${name}" — only ${variables.join(', ')} (plus np./math.) allowed here.`,
      });
    }
  }

  const hasPowerCaret = js.includes('^') || py.includes('^');
  if (hasPowerCaret) {
    issues.push({
      dialect: 'both',
      level: 'warning',
      message: 'Use ** for power, not ^ (^ is XOR, not exponentiation).',
      fix: 'power',
    });
  }

  const level: MathExpressionStatusLevel = issues.some((i) => i.level === 'error')
    ? 'error'
    : issues.length > 0
      ? 'warning'
      : 'ok';
  return { level, issues, hasPowerCaret };
}

/** One-click fix for the `^` warning: `x^2` → `x**2` (both dialects). */
export function replacePowerOperator(expr: string): string {
  return expr.replace(/\^/g, '**');
}

export interface CaretInsertResult {
  next: string;
  /** Caret offset to restore after the store update re-renders the input. */
  caret: number;
}

/**
 * Pure caret-aware insertion: replaces `[start, end)` with `snippet`.
 * Nullish offsets fall back to appending (e.g. element ref unavailable).
 */
export function insertAtCaret(
  current: string,
  start: number | null | undefined,
  end: number | null | undefined,
  snippet: string,
): CaretInsertResult {
  const len = current.length;
  const a =
    typeof start === 'number' && Number.isFinite(start)
      ? Math.max(0, Math.min(start, len))
      : len;
  const b =
    typeof end === 'number' && Number.isFinite(end)
      ? Math.max(a, Math.min(end, len))
      : a;
  const next = current.slice(0, a) + snippet + current.slice(b);
  return { next, caret: a + snippet.length };
}
