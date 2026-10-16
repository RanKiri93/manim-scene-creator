import { defaultSceneDefaults } from '@/store/factories';
import type { FrameDef, ItemId, SceneItem } from '@/types/scene';
import { buildContextPayload } from '../serialize';
import { buildSystemPrompt } from '../systemPrompt';
import { DraftSession } from '../loop/draft';
import { runAgentLoop } from '../loop/runAgentLoop';
import { loopToolSpecs } from '../loop/tools';
import type { LoopConversation, LoopConversationInput, LoopProvider, LoopStep } from '../loop/types';
import type { PracticeCase } from './cases';

const FRAMES: FrameDef[] = [{ id: 'home', col: 0, row: 0 }];

export interface PracticeCaseResult {
  id: string;
  passed: number;
  total: number;
  failures: { check: string; detail: string }[];
  /** Model calls the turn took. */
  steps: number;
  seconds: number;
  /** The run itself failed (provider error, step limit). */
  error?: string;
}

/** Everything the model is taught, hashed, so the history shows when the prompt or tools changed. */
export function promptFingerprint(): string {
  const text = buildSystemPrompt('', 'loop') + JSON.stringify(loopToolSpecs({}));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Plays a case's golden answer: propose it, then finish. */
export function goldenProvider(c: PracticeCase): LoopProvider {
  return {
    startConversation(): LoopConversation {
      let turn = 0;
      return {
        async next(): Promise<LoopStep> {
          turn += 1;
          if (turn === 1) return { text: '', toolCalls: [{ id: 'g1', name: 'propose_changes', input: { actions: c.golden?.actions ?? [] } }] };
          return { text: '', toolCalls: [{ id: 'g2', name: 'finish', input: { reply: 'Done.', ...(c.golden?.styleNote ? { styleNote: c.golden.styleNote } : {}) } }] };
        },
        pushToolResults() {},
      };
    },
  };
}

/** Run one practice request through the tool loop (as the app does) and score its checks. */
export async function runPracticeCase(c: PracticeCase, provider: LoopProvider, signal?: AbortSignal): Promise<PracticeCaseResult> {
  const started = Date.now();
  const items = c.base();
  const defaults = defaultSceneDefaults();
  const session = new DraftSession({
    items: new Map<ItemId, SceneItem>(items.map((it) => [it.id, it])),
    frames: FRAMES,
    startFrameId: 'home',
    activeFrameId: 'home',
    defaults,
    audioItems: [],
    currentTimeSec: 0,
  });
  const input: LoopConversationInput = {
    systemPrompt: buildSystemPrompt('', 'loop'),
    history: [],
    payload: buildContextPayload({ defaults, currentTime: 0, items, frames: FRAMES, startFrameId: 'home', activeFrameId: 'home' }),
    userPrompt: c.prompt,
    tools: loopToolSpecs({}),
    includeThinking: false,
  };
  const inner = provider.startConversation(input);
  let steps = 0;
  const conversation: LoopConversation = {
    next: (s) => {
      steps += 1;
      return inner.next(s);
    },
    pushToolResults: (r) => inner.pushToolResults(r),
  };
  const base = { id: c.id, total: c.checks.length };
  try {
    const outcome = await runAgentLoop({ conversation, session, signal });
    const ctx = { scene: session.scene(), session, outcome };
    const failures = c.checks.flatMap((check) => {
      const r = check.test(ctx);
      return r === true ? [] : [{ check: check.name, detail: r }];
    });
    return {
      ...base,
      passed: c.checks.length - failures.length,
      failures,
      steps,
      seconds: (Date.now() - started) / 1000,
      ...(outcome.stoppedEarly ? { error: 'stopped at the step limit without finishing' } : {}),
    };
  } catch (e) {
    return { ...base, passed: 0, failures: [], steps, seconds: (Date.now() - started) / 1000, error: (e as Error).message };
  }
}

/** One line of the practice history. */
export interface PracticeRun {
  date: string;
  provider: string;
  model: string;
  prompt: string;
  /** passed / total per case id. */
  scores: Record<string, [number, number]>;
}

export function summarizeRun(results: PracticeCaseResult[], meta: Omit<PracticeRun, 'scores'>): PracticeRun {
  return { ...meta, scores: Object.fromEntries(results.map((r) => [r.id, [r.passed, r.total]])) };
}

/** The latest earlier run with the same provider and model (null when there is none). */
export function previousRun(history: PracticeRun[], provider: string, model: string): PracticeRun | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]!;
    if (h.provider === provider && h.model === model) return h;
  }
  return null;
}

/** Cases that scored lower than in `prev` (a regression to look at). */
export function regressions(prev: PracticeRun | null, now: PracticeRun): { id: string; was: string; now: string }[] {
  if (!prev) return [];
  return Object.entries(now.scores).flatMap(([id, [p, t]]) => {
    const old = prev.scores[id];
    if (!old || old[0] / old[1] <= p / t) return [];
    return [{ id, was: `${old[0]}/${old[1]}`, now: `${p}/${t}` }];
  });
}

/** A plain-text report: one line per case, totals, and what got worse. */
export function formatReport(results: PracticeCaseResult[], run: PracticeRun, prev: PracticeRun | null): string {
  const lines = results.map((r) => {
    const mark = r.error ? '!!' : r.passed === r.total ? 'ok' : '--';
    const why = r.error ? `  ${r.error}` : r.failures.map((f) => `  × ${f.check}: ${f.detail}`).join('');
    return `${mark} ${r.id.padEnd(16)} ${r.passed}/${r.total}  ${r.steps} calls  ${r.seconds.toFixed(1)}s${why}`;
  });
  const passed = results.reduce((s, r) => s + r.passed, 0);
  const total = results.reduce((s, r) => s + r.total, 0);
  const full = results.filter((r) => r.passed === r.total && !r.error).length;
  lines.push('', `${run.provider} ${run.model} · prompt ${run.prompt} · checks ${passed}/${total} · requests fully right ${full}/${results.length}`);
  const worse = regressions(prev, run);
  if (prev) {
    lines.push(worse.length ? `Worse than ${prev.date} (prompt ${prev.prompt}): ${worse.map((w) => `${w.id} ${w.was}→${w.now}`).join(', ')}` : `Nothing got worse since ${prev.date}.`);
  }
  return lines.join('\n');
}
