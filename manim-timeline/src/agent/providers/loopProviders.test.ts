import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentChatMessage, AgentContextPayload } from '../types';
import { loopToolSpecs } from '../loop/tools';
import { AnthropicLoopConversation } from './anthropicLoop';
import { OpenAILoopConversation } from './openaiLoop';

const payload = { projectDefaults: {}, currentTimeSec: 0, existingItems: [], frames: [], startFrameId: null, activeFrameId: null } as unknown as AgentContextPayload;
const history: AgentChatMessage[] = [
  { id: 'u0', createdAt: 0, role: 'user', content: 'add axes' },
  { id: 'a0', createdAt: 0, role: 'assistant', content: 'Which range?' },
  { id: 'u1', createdAt: 0, role: 'user', content: '[0,1]' },
  {
    id: 'a1',
    createdAt: 0,
    role: 'assistant',
    content: 'Added.',
    actions: [{ action: 'CREATE', item: { id: 'ax1', kind: 'axes', label: 'axes' } as never }],
    actionsStatus: 'approved',
  },
];
const input = (includeThinking = true) => ({
  systemPrompt: 'SYS',
  history,
  payload,
  userPrompt: 'now a dot',
  tools: loopToolSpecs({}),
  includeThinking,
});
const png = { mediaType: 'image/png' as const, base64: 'AAAA' };

afterEach(() => vi.unstubAllGlobals());

describe('Anthropic loop conversation', () => {
  it('sends tools with auto choice, thinking, and the replayed history', () => {
    const c = new AnthropicLoopConversation('k', 'https://x', 'claude-sonnet-5-5', input());
    const body = c.body();
    expect(body.tool_choice).toEqual({ type: 'auto' });
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect((body.tools as { name: string; input_schema: { type: string } }[]).map((t) => t.name)).toEqual([
      'propose_changes', 'reset_draft', 'inspect_scene', 'find_words', 'check_export', 'finish',
    ]);
    const messages = body.messages as { role: string; content: { text: string }[] }[];
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(messages[3]!.content[0]!.text).toMatch(/\[Applied: CREATE axes "ax1"/);
    expect(messages[4]!.content[0]!.text).toMatch(/now a dot/);
  });

  it('replays the assistant content unchanged and sends tool results with images', async () => {
    const content = [
      { type: 'thinking', thinking: 'plan', signature: 'sig' },
      { type: 'tool_use', id: 'tu1', name: 'snapshot_preview', input: { time: 1 } },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ content }), { status: 200 })));
    const c = new AnthropicLoopConversation('k', 'https://x', 'claude-sonnet-5-5', input());
    const stepResult = await c.next();
    expect(stepResult.toolCalls).toEqual([{ id: 'tu1', name: 'snapshot_preview', input: { time: 1 } }]);
    expect(stepResult.thinking).toBe('plan');
    c.pushToolResults([{ callId: 'tu1', text: '{"ok":true}', images: [png] }]);
    const messages = c.body().messages as { role: string; content: Record<string, unknown>[] }[];
    expect(messages.at(-2)).toEqual({ role: 'assistant', content });
    expect(messages.at(-1)!.content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'tu1',
      content: [{ type: 'text', text: '{"ok":true}' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }],
    });
  });

  it('falls back to the next thinking mode when the first call is rejected over thinking', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('thinking.type: adaptive is not supported', { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: [{ type: 'text', text: 'hi' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const c = new AnthropicLoopConversation('k', 'https://x', 'claude-sonnet-5-5', input());
    expect((await c.next()).text).toBe('hi');
    const second = JSON.parse(fetchMock.mock.calls[1]![1].body as string);
    expect(second.thinking).toEqual({ type: 'enabled', budget_tokens: 4000 });
  });
});

describe('OpenAI loop conversation', () => {
  it('sends function tools and parses tool calls', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'inspect_scene', arguments: '{"times":[1]}' } }] } }],
    }), { status: 200 })));
    const c = new OpenAILoopConversation('k', 'https://x', 'gpt-5.1', input());
    const body = c.body();
    expect(body.reasoning_effort).toBe('medium');
    expect((body.tools as { type: string; function: { name: string } }[])[0]).toMatchObject({ type: 'function', function: { name: 'propose_changes' } });
    const r = await c.next();
    expect(r.toolCalls).toEqual([{ id: 'c1', name: 'inspect_scene', input: { times: [1] } }]);
  });

  it('answers each call with a tool message and sends images in a following user message', () => {
    const c = new OpenAILoopConversation('k', 'https://x', 'gpt-5.1', input(false));
    c.pushToolResults([
      { callId: 'c1', text: 'bad', isError: true },
      { callId: 'c2', text: 'pic', images: [png] },
    ]);
    const messages = c.body().messages as Record<string, unknown>[];
    expect(messages.slice(-3)).toEqual([
      { role: 'tool', tool_call_id: 'c1', content: 'ERROR: bad' },
      { role: 'tool', tool_call_id: 'c2', content: 'pic' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Images returned by the tool calls above, in order.' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        ],
      },
    ]);
  });
});
