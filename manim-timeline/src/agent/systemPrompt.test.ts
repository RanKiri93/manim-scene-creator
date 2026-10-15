import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './systemPrompt';

describe('system prompt modes', () => {
  it('swaps the JSON envelope section for the tool section in loop mode, keeping the rules', () => {
    const single = buildSystemPrompt('');
    const loop = buildSystemPrompt('Keep labels short.', 'loop');
    expect(single).toContain('MUST respond with a single JSON object');
    expect(loop).not.toContain('MUST respond with a single JSON object');
    expect(loop).toContain('WORKING WITH TOOLS');
    expect(loop).toContain('CRITICAL ARCHITECTURE RULES');
    expect(loop).toContain('8e. Connectors');
    expect(loop.endsWith('Keep labels short.')).toBe(true);
  });
});
