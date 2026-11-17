import type { LoopConversation, LoopConversationInput, LoopPartial, LoopProvider, LoopStep, LoopToolResult } from '../loop/types';
import { historyAsPlainTurns, loopUserMessage } from '../loop/history';
import { AgentProviderError, type ProviderConfig } from './types';
import { DEFAULT_OPENAI_MODEL, supportsReasoning } from './openai';
import { partialJsonStringField, readSse } from './sse';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

type ChatMessage = Record<string, unknown> & { role: 'system' | 'user' | 'assistant' | 'tool' };

interface OpenAIToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}
interface OpenAIMessage {
  content?: string | null;
  reasoning_content?: string;
  tool_calls?: OpenAIToolCall[];
}

/**
 * Rebuild the assistant message from a streamed Chat Completions response (content, reasoning,
 * tool calls joined by index), reporting text and the `finish` reply as they arrive.
 */
export async function readOpenAIStream(res: Response, onPartial: (partial: LoopPartial) => void): Promise<OpenAIMessage> {
  let content = '';
  let reasoning = '';
  const calls: OpenAIToolCall[] = [];
  for await (const { data } of readSse(res)) {
    if (!data || data === '[DONE]') continue;
    let chunk: { choices?: { delta?: Record<string, unknown> }[]; error?: { message?: string } };
    try {
      chunk = JSON.parse(data) as typeof chunk;
    } catch {
      continue;
    }
    if (chunk.error) throw new AgentProviderError(`OpenAI stream failed: ${chunk.error.message ?? data}`);
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;
    if (typeof delta.content === 'string') content += delta.content;
    if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content;
    const toolDeltas = Array.isArray(delta.tool_calls) ? (delta.tool_calls as Record<string, unknown>[]) : [];
    for (const d of toolDeltas) {
      const index = typeof d.index === 'number' ? d.index : calls.length;
      const call = (calls[index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
      if (typeof d.id === 'string') call.id = d.id;
      if (typeof d.type === 'string') call.type = d.type;
      const fn = d.function as { name?: string; arguments?: string } | undefined;
      if (fn?.name) call.function.name += fn.name;
      if (fn?.arguments) call.function.arguments += fn.arguments;
    }
    if (typeof delta.content === 'string' || toolDeltas.length) {
      const finish = calls.find((c) => c?.function.name === 'finish');
      const reply = finish ? partialJsonStringField(finish.function.arguments, 'reply') : undefined;
      onPartial({ text: content, ...(reply != null ? { reply } : {}) });
    }
  }
  const toolCalls = calls.filter((c): c is OpenAIToolCall => c != null);
  return {
    content: content || null,
    ...(reasoning ? { reasoning_content: reasoning } : {}),
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  };
}

/**
 * OpenAI-compatible Chat Completions with function calling for the agent loop. Works for OpenAI
 * and for custom endpoints that implement `tools`. Images from tools (snapshots) cannot go in a
 * `tool` message, so they follow as one user message after the tool results.
 */
export function createOpenAILoopProvider(cfg: ProviderConfig): LoopProvider {
  const baseUrl = (cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = cfg.model || DEFAULT_OPENAI_MODEL;
  return {
    startConversation(input: LoopConversationInput): LoopConversation {
      if (!cfg.apiKey) throw new AgentProviderError('OpenAI API key is not configured.');
      return new OpenAILoopConversation(cfg.apiKey, baseUrl, model, input);
    },
  };
}

export class OpenAILoopConversation implements LoopConversation {
  readonly messages: ChatMessage[];
  private readonly tools: unknown[];

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly input: LoopConversationInput;

  constructor(apiKey: string, baseUrl: string, model: string, input: LoopConversationInput) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
    this.input = input;
    this.messages = [
      { role: 'system', content: input.systemPrompt },
      ...historyAsPlainTurns(input.history).map((t) => ({ role: t.role, content: t.text })),
      { role: 'user', content: loopUserMessage(input.payload, input.userPrompt) },
    ];
    this.tools = input.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));
  }

  /** Request body for the current messages (exposed for tests). */
  body(): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: this.messages,
      tools: this.tools,
      tool_choice: 'auto',
    };
    if (this.input.includeThinking && supportsReasoning(this.model)) body.reasoning_effort = 'medium';
    return body;
  }

  async next(signal?: AbortSignal, onPartial?: (partial: LoopPartial) => void): Promise<LoopStep> {
    const stream = Boolean(onPartial && this.input.stream);
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      signal,
      body: JSON.stringify(stream ? { ...this.body(), stream: true } : this.body()),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '<no body>');
      throw new AgentProviderError(`OpenAI request failed (${res.status}): ${text}`, res.status);
    }
    const message = stream
      ? await readOpenAIStream(res, onPartial!)
      : ((await res.json()) as { choices?: { message?: OpenAIMessage }[] }).choices?.[0]?.message;
    if (!message) throw new AgentProviderError('OpenAI returned no message.');
    const toolCalls = message.tool_calls ?? [];
    this.messages.push({
      role: 'assistant',
      content: message.content ?? null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    });
    return {
      text: message.content ?? '',
      thinking: message.reasoning_content?.trim() || undefined,
      toolCalls: toolCalls.map((c) => {
        let parsed: unknown = {};
        try {
          parsed = c.function.arguments ? JSON.parse(c.function.arguments) : {};
        } catch {
          parsed = { __invalidJson: c.function.arguments };
        }
        return { id: c.id, name: c.function.name, input: parsed };
      }),
    };
  }

  pushToolResults(results: LoopToolResult[]): void {
    for (const r of results) {
      this.messages.push({ role: 'tool', tool_call_id: r.callId, content: r.isError ? `ERROR: ${r.text}` : r.text });
    }
    const images = results.flatMap((r) => (r.images ?? []).map((img) => ({ callId: r.callId, img })));
    if (images.length) {
      this.messages.push({
        role: 'user',
        content: [
          { type: 'text', text: 'Images returned by the tool calls above, in order.' },
          ...images.map(({ img }) => ({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.base64}` } })),
        ],
      });
    }
  }
}
