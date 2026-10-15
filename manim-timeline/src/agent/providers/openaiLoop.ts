import type { LoopConversation, LoopConversationInput, LoopProvider, LoopStep, LoopToolResult } from '../loop/types';
import { historyAsPlainTurns, loopUserMessage } from '../loop/history';
import { AgentProviderError, type ProviderConfig } from './types';
import { DEFAULT_OPENAI_MODEL, supportsReasoning } from './openai';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

type ChatMessage = Record<string, unknown> & { role: 'system' | 'user' | 'assistant' | 'tool' };

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

  async next(signal?: AbortSignal): Promise<LoopStep> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      signal,
      body: JSON.stringify(this.body()),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '<no body>');
      throw new AgentProviderError(`OpenAI request failed (${res.status}): ${text}`, res.status);
    }
    const data = (await res.json()) as {
      choices?: {
        message?: {
          content?: string | null;
          reasoning_content?: string;
          tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
        };
      }[];
    };
    const message = data.choices?.[0]?.message;
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
