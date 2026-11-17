import type { AgentChatMessage } from './types';
import { actionLine } from './loop/history';

/** Re-sent history above this many characters is condensed automatically (older turns only). */
export const AUTO_COMPACT_CHARS = 24_000;
/** Messages kept word for word at the end of the history when condensing automatically. */
export const KEEP_RECENT_MESSAGES = 6;

const USER_CHARS = 240;
const REPLY_CHARS = 160;

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function historyChars(messages: AgentChatMessage[]): number {
  return messages.reduce((n, m) => n + m.content.length + (m.actions ? JSON.stringify(m.actions).length : 0), 0);
}

/** A short, deterministic digest of earlier turns: each request, the reply, and what was applied. */
export function summarizeMessages(messages: AgentChatMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.compactMarker) continue;
    if (m.role === 'user') {
      lines.push(`- User: ${clip(m.content, USER_CHARS)}`);
      continue;
    }
    let line = `  Copilot: ${clip(m.content, REPLY_CHARS)}`;
    if (m.actions?.length) {
      line += m.actionsStatus === 'approved'
        ? ` [Applied: ${m.actions.map(actionLine).join('; ')}]`
        : ' [Proposal NOT applied]';
    }
    if (m.error?.length) line += ' [Failed]';
    lines.push(line);
  }
  return lines.join('\n');
}

function summaryPair(messages: AgentChatMessage[]): AgentChatMessage[] {
  const at = messages[0]?.createdAt ?? 0;
  return [
    {
      id: 'compact_summary_user',
      createdAt: at,
      role: 'user',
      content:
        'Summary of the earlier conversation (condensed to save tokens; the current scene JSON is always sent in full):\n' +
        summarizeMessages(messages),
    },
    { id: 'compact_summary_assistant', createdAt: at, role: 'assistant', content: 'Understood. I will continue from that summary.' },
  ];
}

/**
 * The history the model receives. Messages before the last `/compact` divider become one short
 * summary; if what remains is still over {@link AUTO_COMPACT_CHARS}, all but the last
 * {@link KEEP_RECENT_MESSAGES} are condensed too. Dividers themselves are never sent.
 */
export function compactHistory(history: AgentChatMessage[]): AgentChatMessage[] {
  let marker = -1;
  history.forEach((m, i) => {
    if (m.compactMarker) marker = i;
  });
  const before = marker >= 0 ? history.slice(0, marker) : [];
  let recent = history.slice(marker + 1).filter((m) => !m.compactMarker);
  let older = before;
  if (historyChars(recent) > AUTO_COMPACT_CHARS && recent.length > KEEP_RECENT_MESSAGES) {
    let cut = recent.length - KEEP_RECENT_MESSAGES;
    // Start the kept part on a user turn so the turns still alternate.
    while (cut < recent.length && recent[cut]!.role !== 'user') cut++;
    older = [...older, ...recent.slice(0, cut)];
    recent = recent.slice(cut);
  }
  const summarized = older.filter((m) => !m.compactMarker);
  return summarized.length ? [...summaryPair(summarized), ...recent] : recent;
}
