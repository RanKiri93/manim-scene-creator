import { describe, expect, it } from 'vitest';
import type { LoopProvider } from '../loop/types';
import { isRed, isYellow, PRACTICE_CASES } from './cases';
import { formatReport, goldenProvider, previousRun, promptFingerprint, regressions, runPracticeCase, summarizeRun } from './run';

/** A model that answers without changing anything. */
const idle: LoopProvider = {
  startConversation: () => ({
    next: async () => ({ text: '', toolCalls: [{ id: 'f', name: 'finish', input: { reply: 'Done.' } }] }),
    pushToolResults() {},
  }),
};

describe('practice set', () => {
  it('has 25 requests with unique ids and at least one check each', () => {
    expect(PRACTICE_CASES).toHaveLength(25);
    expect(new Set(PRACTICE_CASES.map((c) => c.id)).size).toBe(25);
    for (const c of PRACTICE_CASES) expect(c.checks.length).toBeGreaterThan(0);
  });

  it.each(PRACTICE_CASES.filter((c) => c.golden).map((c) => [c.id, c] as const))('golden answer for %s passes every check', async (_id, c) => {
    const r = await runPracticeCase(c, goldenProvider(c));
    expect(r.error).toBeUndefined();
    expect(r.failures).toEqual([]);
    expect(r.passed).toBe(c.checks.length);
  });

  it.each(PRACTICE_CASES.map((c) => [c.id, c] as const))('doing nothing fails %s', async (_id, c) => {
    const r = await runPracticeCase(c, idle);
    expect(r.passed).toBeLessThan(r.total);
  });

  it('tells colours apart', () => {
    expect(isYellow('#facc15')).toBe(true);
    expect(isYellow('#ffff00')).toBe(true);
    expect(isYellow('#ef4444')).toBe(false);
    expect(isRed('#ef4444')).toBe(true);
    expect(isRed('#f97316')).toBe(false);
  });
});

describe('practice history', () => {
  const run = (date: string, model: string, scores: Record<string, [number, number]>) => ({ date, provider: 'anthropic', model, prompt: 'abc', scores });

  it('finds the last run of the same model and flags cases that got worse', () => {
    const history = [run('d1', 'm1', { a: [2, 2], b: [1, 3] }), run('d2', 'm2', { a: [0, 2] }), run('d3', 'm1', { a: [2, 2], b: [2, 3] })];
    const prev = previousRun(history, 'anthropic', 'm1');
    expect(prev?.date).toBe('d3');
    const now = run('d4', 'm1', { a: [1, 2], b: [3, 3], c: [0, 1] });
    expect(regressions(prev, now)).toEqual([{ id: 'a', was: '2/2', now: '1/2' }]);
    expect(regressions(null, now)).toEqual([]);
  });

  it('reports per request with totals and the prompt fingerprint', () => {
    const results = [
      { id: 'a', passed: 2, total: 2, failures: [], steps: 3, seconds: 4.2 },
      { id: 'b', passed: 1, total: 2, failures: [{ check: 'the dot ends at x = 2', detail: 'ends at x = 1.5' }], steps: 5, seconds: 9 },
    ];
    const now = summarizeRun(results, { date: 'today', provider: 'anthropic', model: 'm1', prompt: promptFingerprint() });
    const report = formatReport(results, now, run('yesterday', 'm1', { a: [2, 2], b: [2, 2] }));
    expect(report).toContain('ok a');
    expect(report).toContain('-- b');
    expect(report).toContain('× the dot ends at x = 2: ends at x = 1.5');
    expect(report).toContain('checks 3/4 · requests fully right 1/2');
    expect(report).toContain('Worse than yesterday (prompt abc): b 2/2→1/2');
    expect(promptFingerprint()).toMatch(/^[0-9a-f]{8}$/);
  });
});
