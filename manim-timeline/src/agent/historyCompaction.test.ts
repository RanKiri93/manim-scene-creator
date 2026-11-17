import { describe, expect, it } from 'vitest';
import type { AgentChatMessage } from './types';
import { AUTO_COMPACT_CHARS, compactHistory, summarizeMessages } from './historyCompaction';

let n = 0;
const user = (content: string): AgentChatMessage => ({ id: `u${n++}`, createdAt: n, role: 'user', content });
const asst = (content: string, extra: Partial<AgentChatMessage> = {}): AgentChatMessage => ({ id: `a${n++}`, createdAt: n, role: 'assistant', content, ...extra });
const marker = (): AgentChatMessage => asst('Condensed', { compactMarker: true });

describe('Copilot history compaction', () => {
  it('sends short histories unchanged', () => {
    const h = [user('add a title'), asst('done')];
    expect(compactHistory(h)).toEqual(h);
  });

  it('turns everything before /compact into one summary and never sends the divider', () => {
    const applied = asst('Added it.', {
      actions: [{ action: 'CREATE', item: { id: 't1', kind: 'textLine', label: 'Title' } as never }],
      actionsStatus: 'approved',
    });
    const h = [
      user('add a title'),
      applied,
      user('make it red'),
      asst('Proposal', { actions: [{ action: 'DELETE', itemId: 't1' }], actionsStatus: 'rejected' }),
      marker(),
      user('now a graph'),
      asst('ok'),
    ];
    const out = compactHistory(h);
    expect(out).toHaveLength(4);
    expect(out[0]!.role).toBe('user');
    expect(out[0]!.content).toContain('- User: add a title');
    expect(out[0]!.content).toContain('[Applied: CREATE textLine "t1" (Title)]');
    expect(out[0]!.content).toContain('[Proposal NOT applied]');
    expect(out[1]!.role).toBe('assistant');
    expect(out.slice(2).map((m) => m.content)).toEqual(['now a graph', 'ok']);
    expect(out.some((m) => m.compactMarker)).toBe(false);
  });

  it('condenses older turns on its own when the history gets long', () => {
    const long = 'x'.repeat(AUTO_COMPACT_CHARS / 8);
    const h: AgentChatMessage[] = [];
    for (let i = 0; i < 10; i++) h.push(user(`request ${i} ${long}`), asst(`reply ${i}`));
    const out = compactHistory(h);
    expect(out[0]!.content).toMatch(/^Summary of the earlier conversation/);
    const kept = out.slice(2);
    expect(kept.length).toBeLessThanOrEqual(6);
    expect(kept[0]!.role).toBe('user');
    expect(kept.at(-1)!.content).toBe('reply 9');
  });

  it('clips long messages in the summary', () => {
    expect(summarizeMessages([user('a'.repeat(1000))]).length).toBeLessThan(260);
  });
});
