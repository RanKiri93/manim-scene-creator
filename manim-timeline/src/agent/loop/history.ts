import type { AgentAction, AgentChatMessage, AgentContextPayload } from '../types';
import { describeAudioEdit } from '../audioEdits';
import { describeTimelineEdit } from '../timelineEdits';

export interface PlainTurn {
  role: 'user' | 'assistant';
  text: string;
}

function actionLine(a: AgentAction): string {
  if (a.action === 'CREATE') return `CREATE ${a.item.kind} "${a.item.id}"${a.item.label ? ` (${a.item.label})` : ''}`;
  if (a.action === 'UPDATE') return `UPDATE "${a.itemId}": ${Object.keys(a.updates).join(', ')}`;
  if (a.action === 'TIMELINE') return `TIMELINE ${describeTimelineEdit(a.edit)}`;
  if (a.action === 'AUDIO') return `AUDIO ${describeAudioEdit(a.edit)}`;
  return `DELETE "${a.itemId}"`;
}

/**
 * Earlier turns as plain alternating text for tool-loop providers. Applied proposals are listed
 * briefly (the current scene JSON is sent with the new message anyway); rejected or superseded
 * ones are marked as not applied. Consecutive turns of one role are merged.
 */
export function historyAsPlainTurns(history: AgentChatMessage[]): PlainTurn[] {
  const out: PlainTurn[] = [];
  for (const m of history) {
    let text = m.content;
    if (m.role === 'assistant' && m.actions?.length) {
      if (m.actionsStatus === 'approved') text += `\n\n[Applied: ${m.actions.map(actionLine).join('; ')}]`;
      else if (m.actionsStatus === 'rejected') text += '\n\n(Note: the user rejected this proposal; it was NOT applied.)';
      else if (m.actionsStatus === 'superseded') text += '\n\n(Note: this proposal was superseded; it was NOT applied.)';
      else text += '\n\n(Note: this proposal was never approved; it is NOT in the scene.)';
    }
    if (m.role === 'assistant' && m.error?.length) text += `\n\n(Errors: ${m.error.join(' | ')})`;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.text += `\n\n${text}`;
    else out.push({ role: m.role, text });
  }
  while (out.length && out[0]!.role !== 'user') out.shift();
  return out;
}

/** The new user message: scene state, the request, and how to answer. */
export function loopUserMessage(payload: AgentContextPayload, userPrompt: string): string {
  return (
    'Current project state (JSON):\n```json\n' +
    JSON.stringify(payload) +
    '\n```\n\nUser message:\n' +
    userPrompt +
    '\n\nWork with the tools (propose_changes, inspect_scene, check_export, …) and end the turn with finish({reply}).'
  );
}
