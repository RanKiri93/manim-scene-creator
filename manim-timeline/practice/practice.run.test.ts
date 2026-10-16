/**
 * Copilot practice run: the 25 requests in src/agent/practice/cases.ts against a real model,
 * through the same tool loop the app uses, scored by their checks.
 *
 *   PowerShell:  $env:ANTHROPIC_API_KEY = '…'; npm run practice
 *                $env:OPENAI_API_KEY = '…'; $env:PRACTICE_PROVIDER = 'openai'; npm run practice
 *   Options:     PRACTICE_MODEL (default: the app's default for the provider),
 *                PRACTICE_ONLY=drop-line,tangent (a subset), PRACTICE_PROVIDER=golden (no key: the
 *                known-good answers, to check the harness itself).
 *
 * Keys are read from the environment only and never written anywhere. Each run appends one line
 * (provider, model, prompt fingerprint, scores — no keys, no prompts) to practice/history.jsonl
 * (git-ignored) and reports cases that scored lower than the last run of the same model; the
 * report is also saved to practice/last-report.txt.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'vitest';
import { getLoopProvider } from '@/agent/providers';
import { DEFAULT_ANTHROPIC_MODEL } from '@/agent/providers/anthropic';
import { DEFAULT_OPENAI_MODEL } from '@/agent/providers/openai';
import type { LoopProvider } from '@/agent/loop/types';
import { PRACTICE_CASES } from '@/agent/practice/cases';
import {
  formatReport,
  goldenProvider,
  previousRun,
  promptFingerprint,
  runPracticeCase,
  summarizeRun,
  type PracticeCaseResult,
  type PracticeRun,
} from '@/agent/practice/run';

const env = process.env;
const providerId = env.PRACTICE_PROVIDER ?? (env.ANTHROPIC_API_KEY ? 'anthropic' : env.OPENAI_API_KEY ? 'openai' : '');
const apiKey = providerId === 'anthropic' ? env.ANTHROPIC_API_KEY : providerId === 'openai' ? env.OPENAI_API_KEY : undefined;
const enabled = providerId === 'golden' || ((providerId === 'anthropic' || providerId === 'openai') && !!apiKey);
const HISTORY = path.resolve(__dirname, 'history.jsonl');
const REPORT = path.resolve(__dirname, 'last-report.txt');

it.skipIf(!enabled)(
  `practice run (${providerId || 'no key set'})`,
  async () => {
    const model = providerId === 'golden' ? 'golden' : env.PRACTICE_MODEL || (providerId === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_OPENAI_MODEL);
    const only = (env.PRACTICE_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const cases = PRACTICE_CASES.filter((c) => (!only.length || only.includes(c.id)) && (providerId !== 'golden' || !!c.golden));
    const results: PracticeCaseResult[] = [];
    for (const c of cases) {
      const provider: LoopProvider | null =
        providerId === 'golden' ? goldenProvider(c) : getLoopProvider({ provider: providerId as 'anthropic' | 'openai', apiKey: apiKey!, baseUrl: '', model });
      if (!provider) throw new Error(`No tool-loop provider for "${providerId}".`);
      const r = await runPracticeCase(c, provider);
      results.push(r);
      process.stdout.write(`${r.error ? '!!' : r.passed === r.total ? 'ok' : '--'} ${c.id} ${r.passed}/${r.total}\n`);
    }
    const history: PracticeRun[] = existsSync(HISTORY)
      ? readFileSync(HISTORY, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as PracticeRun)
      : [];
    const run = summarizeRun(results, { date: new Date().toISOString(), provider: providerId, model, prompt: promptFingerprint() });
    const prev = only.length ? null : previousRun(history, providerId, model);
    const report = formatReport(results, run, prev);
    writeFileSync(REPORT, report + '\n');
    process.stdout.write(`\n${report}\n\n(also in ${REPORT})\n`);
    // A subset is not comparable with full runs, so only full runs go into the history.
    if (!only.length) appendFileSync(HISTORY, JSON.stringify(run) + '\n');
  },
  60 * 60 * 1000,
);
