import { describe, expect, it } from 'vitest';
import { buildAnthropicBody, supportsExtendedThinking, thinkingModesFor } from './anthropic';

describe('anthropic request building', () => {
  it('recognises thinking-capable models, including current ones', () => {
    expect(supportsExtendedThinking('claude-sonnet-5-5')).toBe(true);
    expect(supportsExtendedThinking('claude-opus-4-1')).toBe(true);
    expect(supportsExtendedThinking('claude-3-7-sonnet-latest')).toBe(true);
    expect(supportsExtendedThinking('claude-3-5-sonnet-latest')).toBe(false);
    expect(supportsExtendedThinking('claude-3-haiku-20240307')).toBe(false);
  });

  it('tries adaptive thinking first on newer models and always ends without thinking', () => {
    expect(thinkingModesFor('claude-sonnet-5-5', true)).toEqual(['adaptive', 'enabled', 'off']);
    expect(thinkingModesFor('claude-sonnet-4-5-20250929', true)).toEqual(['enabled', 'off']);
    expect(thinkingModesFor('claude-sonnet-5-5', false)).toEqual(['off']);
  });

  it('never forces a tool while thinking, and forces emit_response otherwise', () => {
    const thinking = buildAnthropicBody({ model: 'm', systemPrompt: 's', messages: [], thinking: 'adaptive' });
    expect(thinking.tool_choice).toEqual({ type: 'auto' });
    expect(thinking.thinking).toEqual({ type: 'adaptive' });
    const budget = buildAnthropicBody({ model: 'm', systemPrompt: 's', messages: [], thinking: 'enabled' });
    expect(budget.tool_choice).toEqual({ type: 'auto' });
    expect((budget.max_tokens as number) > (budget.thinking as { budget_tokens: number }).budget_tokens).toBe(true);
    const plain = buildAnthropicBody({ model: 'm', systemPrompt: 's', messages: [], thinking: 'off' });
    expect(plain.tool_choice).toEqual({ type: 'tool', name: 'emit_response' });
    expect(plain).not.toHaveProperty('thinking');
    expect(plain.max_tokens).toBeGreaterThanOrEqual(16000);
  });
});
