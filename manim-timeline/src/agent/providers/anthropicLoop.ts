import type { LoopConversation, LoopConversationInput, LoopProvider, LoopStep, LoopToolResult } from '../loop/types';
import { historyAsPlainTurns, loopUserMessage } from '../loop/history';
import { AgentProviderError, type ProviderConfig } from './types';
import { buildAnthropicBody, DEFAULT_ANTHROPIC_MODEL, thinkingModesFor, type AnthropicThinkingMode } from './anthropic';

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

type Block = Record<string, unknown> & { type: string };
interface WireMessage {
  role: 'user' | 'assistant';
  content: Block[];
}

/**
 * Anthropic Messages API with real tool use for the agent loop. The full assistant content
 * (thinking blocks with signatures, text, tool_use) is sent back unchanged on the next call, as
 * the API requires when thinking is combined with tools.
 */
export function createAnthropicLoopProvider(cfg: ProviderConfig): LoopProvider {
  const baseUrl = (cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = cfg.model || DEFAULT_ANTHROPIC_MODEL;
  return {
    startConversation(input: LoopConversationInput): LoopConversation {
      if (!cfg.apiKey) throw new AgentProviderError('Anthropic API key is not configured.');
      return new AnthropicLoopConversation(cfg.apiKey, baseUrl, model, input);
    },
  };
}

export class AnthropicLoopConversation implements LoopConversation {
  readonly messages: WireMessage[];
  private modes: AnthropicThinkingMode[];
  /** True after the first successful call; the thinking mode is fixed from then on. */
  private answered = false;
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
      ...historyAsPlainTurns(input.history).map((t) => ({ role: t.role, content: [{ type: 'text', text: t.text }] })),
      { role: 'user', content: [{ type: 'text', text: loopUserMessage(input.payload, input.userPrompt) }] },
    ];
    this.modes = thinkingModesFor(model, input.includeThinking);
    this.tools = input.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  }

  /** Request body for the current messages (exposed for tests). */
  body(mode: AnthropicThinkingMode = this.modes[0]!): Record<string, unknown> {
    return buildAnthropicBody({
      model: this.model,
      systemPrompt: this.input.systemPrompt,
      messages: this.messages,
      thinking: mode,
      tools: this.tools,
      toolChoice: { type: 'auto' },
    });
  }

  async next(signal?: AbortSignal): Promise<LoopStep> {
    let res: Response | null = null;
    while (this.modes.length) {
      res = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        signal,
        body: JSON.stringify(this.body()),
      });
      if (res.ok) break;
      const text = await res.text().catch(() => '<no body>');
      // Fall back to the next thinking mode only on the first call of the turn, before any
      // thinking block has to be replayed.
      const canFallBack = this.modes.length > 1 && !this.answered && /thinking|adaptive|budget/i.test(text);
      if (res.status === 400 && canFallBack) {
        this.modes = this.modes.slice(1);
        continue;
      }
      throw new AgentProviderError(`Anthropic request failed (${res.status}): ${text}`, res.status);
    }
    if (!res?.ok) throw new AgentProviderError('Anthropic request was not sent.');
    const data = (await res.json()) as { content?: Block[] };
    const content = data.content ?? [];
    this.answered = true;
    this.messages.push({ role: 'assistant', content });
    return {
      text: content.filter((b) => b.type === 'text').map((b) => String(b.text ?? '')).join('\n'),
      thinking: content.filter((b) => b.type === 'thinking').map((b) => String(b.thinking ?? '')).join('\n\n') || undefined,
      toolCalls: content
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ id: String(b.id), name: String(b.name), input: b.input })),
    };
  }

  pushToolResults(results: LoopToolResult[]): void {
    this.messages.push({
      role: 'user',
      content: results.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.callId,
        ...(r.isError ? { is_error: true } : {}),
        content: [
          { type: 'text', text: r.text },
          ...(r.images ?? []).map((img) => ({
            type: 'image',
            source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
          })),
        ],
      })),
    });
  }
}
