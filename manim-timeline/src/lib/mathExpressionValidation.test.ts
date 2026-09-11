import { describe, expect, it } from 'vitest';
import {
  insertAtCaret,
  replacePowerOperator,
  validateMathExpressionPair,
} from '@/lib/mathExpressionValidation';

describe('validateMathExpressionPair', () => {
  it('passes a valid scalar pair', () => {
    const s = validateMathExpressionPair({
      jsExpr: 'Math.sin(x)',
      pyExpr: 'np.sin(x)',
    });
    expect(s.level).toBe('ok');
    expect(s.issues).toHaveLength(0);
    expect(s.hasPowerCaret).toBe(false);
  });

  it('allows namespace members without flagging them as variables', () => {
    const s = validateMathExpressionPair({
      jsExpr: 'Math.sin(Math.PI * x) + Math.E',
      pyExpr: 'np.sin(np.pi * x) + np.e',
    });
    expect(s.level).toBe('ok');
  });

  it('flags JS syntax errors as errors', () => {
    for (const jsExpr of ['Math.sin(', '((((']) {
      const s = validateMathExpressionPair({ jsExpr, pyExpr: 'x' });
      expect(s.level).toBe('error');
      expect(
        s.issues.some((i) => i.dialect === 'js' && /syntax/i.test(i.message)),
      ).toBe(true);
    }
  });

  it('flags empty expressions as errors', () => {
    const emptyJs = validateMathExpressionPair({ jsExpr: '  ', pyExpr: 'x' });
    expect(emptyJs.level).toBe('error');
    const emptyPy = validateMathExpressionPair({ jsExpr: 'x', pyExpr: '' });
    expect(emptyPy.level).toBe('error');
  });

  it('flags disallowed variables per scalar-x context', () => {
    const s = validateMathExpressionPair({
      jsExpr: 'y + x',
      pyExpr: 't * x',
    });
    expect(s.level).toBe('error');
    expect(s.issues.some((i) => /"y"/.test(i.message))).toBe(true);
    expect(s.issues.some((i) => /"t"/.test(i.message))).toBe(true);
  });

  it('flags JS-looking tokens in the Python box without executing it', () => {
    const s = validateMathExpressionPair({
      jsExpr: 'x',
      pyExpr: 'Math.sin(x)',
    });
    expect(s.level).toBe('error');
    expect(
      s.issues.some(
        (i) => i.dialect === 'py' && /JavaScript/i.test(i.message),
      ),
    ).toBe(true);
  });

  it('reports unbalanced Python brackets as errors', () => {
    const s = validateMathExpressionPair({
      jsExpr: 'x',
      pyExpr: 'np.sin((x)',
    });
    expect(s.level).toBe('error');
    expect(
      s.issues.some((i) => i.dialect === 'py' && /nbalanced/i.test(i.message)),
    ).toBe(true);
  });

  it('treats ^ as a non-blocking warning with a power fix', () => {
    const s = validateMathExpressionPair({
      jsExpr: 'x^2',
      pyExpr: 'x^2',
    });
    expect(s.level).toBe('warning');
    expect(s.hasPowerCaret).toBe(true);
    const warn = s.issues.find((i) => i.fix === 'power');
    expect(warn?.level).toBe('warning');
    expect(warn?.message).toMatch(/\*\*/);
    expect(replacePowerOperator('x^2 + y^3')).toBe('x**2 + y**3');
  });

  it('keeps ^ a warning even when the pair is otherwise valid', () => {
    const s = validateMathExpressionPair({
      jsExpr: 'x^2 + Math.sin(x)',
      pyExpr: 'x**2 + np.sin(x)',
    });
    expect(s.level).toBe('warning');
    expect(s.issues.some((i) => i.level === 'error')).toBe(false);
  });
});

describe('validateMathExpressionPair variable contexts', () => {
  it('accepts t for parametric curves and path offsets', () => {
    const s = validateMathExpressionPair({
      jsExpr: 'Math.cos(t)',
      pyExpr: 'np.cos(t)',
      variables: ['t'],
    });
    expect(s.level).toBe('ok');
  });

  it('accepts x and y for field expressions', () => {
    const s = validateMathExpressionPair({
      jsExpr: 'Math.exp(-(x*x + y*y))',
      pyExpr: 'np.exp(-(x*x + y*y))',
      variables: ['x', 'y'],
    });
    expect(s.level).toBe('ok');
  });

  it('accepts n and x for function-series terms', () => {
    const s = validateMathExpressionPair({
      jsExpr: 'Math.sin(n*x)/n',
      pyExpr: 'np.sin(n*x)/n',
      variables: ['n', 'x'],
    });
    expect(s.level).toBe('ok');
  });

  it('accepts n alone for point-sequence coordinates', () => {
    const s = validateMathExpressionPair({
      jsExpr: 'n',
      pyExpr: 'n',
      variables: ['n'],
    });
    expect(s.level).toBe('ok');
  });

  it('rejects out-of-context identifiers per context', () => {
    const curve = validateMathExpressionPair({
      jsExpr: 'x + t',
      pyExpr: 'x + t',
      variables: ['t'],
    });
    expect(curve.level).toBe('error');
    expect(curve.issues.some((i) => /"x"/.test(i.message))).toBe(true);

    const seq = validateMathExpressionPair({
      jsExpr: 'n + x',
      pyExpr: 'n',
      variables: ['n'],
    });
    expect(seq.level).toBe('error');
    expect(seq.issues.some((i) => /"x"/.test(i.message))).toBe(true);
  });

  it('keeps ^ a warning in non-x contexts too', () => {
    const s = validateMathExpressionPair({
      jsExpr: 't^2',
      pyExpr: 't^2',
      variables: ['t'],
    });
    expect(s.level).toBe('warning');
    expect(s.hasPowerCaret).toBe(true);
    expect(replacePowerOperator('t^2')).toBe('t**2');
  });
});

describe('insertAtCaret', () => {
  it('inserts at the caret and reports the restore offset', () => {
    const r = insertAtCaret('x*x', 1, 1, 'Math.sin(');
    expect(r.next).toBe('xMath.sin(*x');
    expect(r.caret).toBe(1 + 'Math.sin('.length);
  });

  it('replaces a selection range', () => {
    const r = insertAtCaret('xxx', 0, 3, 'Math.sin(x)');
    expect(r.next).toBe('Math.sin(x)');
    expect(r.caret).toBe('Math.sin(x)'.length);
  });

  it('appends when offsets are unavailable', () => {
    const r = insertAtCaret('x', null, null, '**2');
    expect(r.next).toBe('x**2');
    expect(r.caret).toBe(4);
  });
});
