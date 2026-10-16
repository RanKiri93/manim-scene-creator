import type { AgentAction } from '../types';
import type { DraftSession } from './draft';
import { runLoopTool, type LoopToolEnv } from './tools';
import type { LoopConversation, LoopLogEntry } from './types';

/** Model calls per user turn. Each call may run several tools. */
export const MAX_LOOP_STEPS = 10;

export interface LoopProgress {
  step: number;
  log: LoopLogEntry[];
  draft: AgentAction[];
}

export interface LoopOutcome {
  reply: string;
  actions: AgentAction[];
  thinking?: string;
  warnings: string[];
  log: LoopLogEntry[];
  /** True when the step limit ended the turn before `finish`. */
  stoppedEarly: boolean;
  /** A style note the Copilot suggests for the project (from `finish`). */
  styleNote?: string;
}

/**
 * Drive one user turn: call the model, run its tool calls against the draft, send the results
 * back, until it calls `finish`, answers without tools, or the step limit is hit.
 */
export async function runAgentLoop(args: {
  conversation: LoopConversation;
  session: DraftSession;
  env?: LoopToolEnv;
  maxSteps?: number;
  signal?: AbortSignal;
  onProgress?: (progress: LoopProgress) => void;
}): Promise<LoopOutcome> {
  const { conversation, session, env = {}, signal, onProgress } = args;
  const maxSteps = args.maxSteps ?? MAX_LOOP_STEPS;
  const log: LoopLogEntry[] = [];
  const thinking: string[] = [];
  const report = (step: number) => onProgress?.({ step, log: [...log], draft: session.actions });

  for (let step = 1; step <= maxSteps; step++) {
    const response = await conversation.next(signal);
    if (response.thinking) thinking.push(response.thinking);
    if (response.toolCalls.length === 0) {
      // A plain answer ends the turn; keep whatever the draft holds.
      return done(response.text.trim() || 'Done.', false);
    }
    const results = [];
    let finished: { reply: string; styleNote?: string } | undefined;
    for (const call of response.toolCalls) {
      const outcome = await runLoopTool(call, session, env);
      const picture = outcome.seen && outcome.result.images?.[0];
      const src = picture && env.thumbnail ? await env.thumbnail(picture).catch(() => null) : null;
      log.push({
        tool: call.name,
        summary: outcome.summary,
        ...(outcome.result.isError ? { isError: true } : {}),
        ...(src && outcome.seen ? { image: { src, ...outcome.seen } } : {}),
      });
      results.push(outcome.result);
      if (outcome.finished) finished = outcome.finished;
      report(step);
    }
    if (finished) return { ...done(finished.reply, false), ...(finished.styleNote ? { styleNote: finished.styleNote } : {}) };
    conversation.pushToolResults(results);
  }
  return done(
    `I stopped after ${maxSteps} steps without finishing. The draft below is what I had so far; review it before applying.`,
    true,
  );

  function done(reply: string, stoppedEarly: boolean): LoopOutcome {
    return {
      reply,
      actions: session.actions,
      ...(thinking.length ? { thinking: thinking.join('\n\n') } : {}),
      warnings: session.warnings,
      log,
      stoppedEarly,
    };
  }
}
