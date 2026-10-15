import { AGENT_CHAT_RESPONSE_JSON_SCHEMA } from '../types';
import type { AgentChatMessage, AgentContextPayload } from '../types';
import {
  AgentProviderError,
  type AgentProvider,
  type ProviderConfig,
  type ProviderGenerateInput,
  type RawAgentResponse,
} from './types';

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';
const ANTHROPIC_VERSION = '2023-06-01';
const THINKING_BUDGET_TOKENS = 4000;
/** Room for large proposals; thinking budget comes on top for `enabled` thinking. */
export const ANTHROPIC_MAX_TOKENS = 16000;

/**
 * How extended thinking is requested. Newer models take `adaptive`; older ones a fixed budget.
 * A request that the API rejects because of the thinking field is retried with the next mode.
 */
export type AnthropicThinkingMode = 'adaptive' | 'enabled' | 'off';

/**
 * Anthropic Messages API provider that forces a structured JSON response by
 * exposing an `emit_response` tool and requiring the model to call it.
 *
 * Multi-turn history is replayed as alternating user/assistant messages.
 * Prior assistant turns are re-emitted as a `tool_use` block with the same
 * envelope the model produced last time, so the tool-forced path stays
 * consistent across turns. When `includeThinking` is requested and the model
 * supports extended thinking, we enable it and extract the `thinking` block
 * content alongside the structured response.
 */
export function createAnthropicProvider(cfg: ProviderConfig): AgentProvider {
  const baseUrl = (cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = cfg.model || DEFAULT_ANTHROPIC_MODEL;

  return {
    id: 'anthropic',
    async generate({
      payload,
      systemPrompt,
      history,
      userPrompt,
      includeThinking,
      signal,
    }: ProviderGenerateInput): Promise<RawAgentResponse> {
      if (!cfg.apiKey) {
        throw new AgentProviderError('Anthropic API key is not configured.');
      }

      const messages = buildAnthropicMessages({ history, payload, userPrompt });
      const modes = thinkingModesFor(model, includeThinking);

      let res: Response | null = null;
      for (let i = 0; i < modes.length; i++) {
        const body = buildAnthropicBody({
          model,
          systemPrompt,
          messages,
          thinking: modes[i]!,
        });
        res = await fetch(`${baseUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': cfg.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          signal,
          body: JSON.stringify(body),
        });
        if (res.ok) break;
        const text = await safeText(res);
        if (res.status === 400 && i < modes.length - 1 && /thinking|adaptive|budget/i.test(text)) continue;
        throw new AgentProviderError(
          `Anthropic request failed (${res.status}): ${text}`,
          res.status,
        );
      }
      if (!res) throw new AgentProviderError('Anthropic request was not sent.');
      const data = (await res.json()) as {
        content?: {
          type: string;
          input?: unknown;
          name?: string;
          thinking?: string;
          text?: string;
        }[];
      };
      const blocks = data.content ?? [];
      const toolUse = blocks.find(
        (c) => c.type === 'tool_use' && c.name === 'emit_response',
      );
      if (
        !toolUse ||
        typeof toolUse.input !== 'object' ||
        toolUse.input === null
      ) {
        // With thinking on, tool use cannot be forced: accept a plain-text answer as a chat reply.
        const text = blocks
          .filter((c) => c.type === 'text' && typeof c.text === 'string')
          .map((c) => c.text as string)
          .join('\n')
          .trim();
        const parsed = text ? parseJsonEnvelope(text) : null;
        if (parsed) return parsed;
        if (text) return { reply: text, actions: [] };
        throw new AgentProviderError(
          'Anthropic did not invoke the emit_response tool.',
        );
      }

      // Collect any `thinking` blocks that came before the tool call.
      const thinking = blocks
        .filter((c) => c.type === 'thinking' && typeof c.thinking === 'string')
        .map((c) => c.thinking as string)
        .join('\n\n')
        .trim();

      const payloadObj = toolUse.input as Record<string, unknown>;
      if (thinking) {
        payloadObj.thinking = thinking;
      }
      return payloadObj;
    },
  };
}

/** Every Claude model from 3.7 on supports extended thinking; older 3.x / 2.x do not. */
export function supportsExtendedThinking(model: string): boolean {
  const m = model.toLowerCase();
  if (!m.includes('claude')) return false;
  if (m.includes('claude-3-7') || m.includes('claude-3.7')) return true;
  return !/claude-(instant|2|3)([-.]|$)/.test(m);
}

/** Models that take `thinking: {type: 'adaptive'}` (Claude 4.6 and later). */
function prefersAdaptiveThinking(model: string): boolean {
  const m = model.toLowerCase();
  const match = /claude-(?:opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/.exec(m);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = match[2] != null && match[2].length <= 2 ? Number(match[2]) : 0;
  return major > 4 || (major === 4 && minor >= 6);
}

/** Thinking modes to try in order; the last one is always `off`. */
export function thinkingModesFor(model: string, includeThinking: boolean): AnthropicThinkingMode[] {
  if (!includeThinking || !supportsExtendedThinking(model)) return ['off'];
  return prefersAdaptiveThinking(model) ? ['adaptive', 'enabled', 'off'] : ['enabled', 'off'];
}

/**
 * Request body for one structured turn. Tool use can only be forced without thinking
 * (the API rejects a forced `tool_choice` with extended thinking), so thinking turns use `auto`.
 */
export function buildAnthropicBody(args: {
  model: string;
  systemPrompt: string;
  messages: unknown[];
  thinking: AnthropicThinkingMode;
  tools?: unknown[];
  toolChoice?: unknown;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: args.model,
    max_tokens: args.thinking === 'enabled' ? ANTHROPIC_MAX_TOKENS + THINKING_BUDGET_TOKENS : ANTHROPIC_MAX_TOKENS,
    system: args.systemPrompt,
    tools: args.tools ?? [
      {
        name: 'emit_response',
        description:
          'Emit the chat reply and the list of CREATE / UPDATE / DELETE actions (possibly empty) for this turn.',
        input_schema: AGENT_CHAT_RESPONSE_JSON_SCHEMA,
      },
    ],
    tool_choice:
      args.thinking === 'off'
        ? (args.toolChoice ?? { type: 'tool', name: 'emit_response' })
        : { type: 'auto' },
    messages: args.messages,
  };
  if (args.thinking === 'adaptive') body.thinking = { type: 'adaptive' };
  if (args.thinking === 'enabled') body.thinking = { type: 'enabled', budget_tokens: THINKING_BUDGET_TOKENS };
  return body;
}

/** Parse `{reply, actions}` from a text answer, tolerating a fenced code block. */
function parseJsonEnvelope(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced ? fenced[1]! : text).trim();
  if (!candidate.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return parsed && typeof parsed === 'object' && 'reply' in parsed ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface BuildAnthropicMessagesInput {
  history: AgentChatMessage[];
  payload: AgentContextPayload;
  userPrompt: string;
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'tool_use';
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string;
    };

function buildAnthropicMessages(input: BuildAnthropicMessagesInput): {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}[] {
  const out: {
    role: 'user' | 'assistant';
    content: AnthropicContentBlock[];
  }[] = [];
  let pendingToolUseId: string | null = null;
  let counter = 0;

  const newToolUseId = () => {
    counter += 1;
    return `toolu_history_${counter.toString(36)}`;
  };

  for (const m of input.history) {
    if (m.role === 'user') {
      // Anthropic requires a tool_result immediately after a tool_use.
      if (pendingToolUseId) {
        out.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: pendingToolUseId,
              content: 'ok',
            },
            { type: 'text', text: m.content },
          ],
        });
        pendingToolUseId = null;
      } else {
        out.push({
          role: 'user',
          content: [{ type: 'text', text: m.content }],
        });
      }
    } else {
      const applied = m.actionsStatus === 'approved' ? (m.actions ?? []) : [];
      const noteSuffix =
        m.actionsStatus === 'rejected'
          ? '\n\n(Note: the user rejected the previous proposal; it was NOT applied.)'
          : m.actionsStatus === 'superseded'
            ? '\n\n(Note: the previous proposal was superseded by a newer reply; it was NOT applied.)'
            : '';
      const toolUseId = newToolUseId();
      out.push({
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: toolUseId,
            name: 'emit_response',
            input: {
              reply: m.content + noteSuffix,
              actions: applied,
            },
          },
        ],
      });
      pendingToolUseId = toolUseId;
    }
  }

  // Current user turn — carries the scene payload preamble.
  const currentUserText = buildCurrentUserText(input.payload, input.userPrompt);
  if (pendingToolUseId) {
    out.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: pendingToolUseId,
          content: 'ok',
        },
        { type: 'text', text: currentUserText },
      ],
    });
  } else {
    out.push({
      role: 'user',
      content: [{ type: 'text', text: currentUserText }],
    });
  }
  return out;
}

function buildCurrentUserText(
  payload: AgentContextPayload,
  userPrompt: string,
): string {
  return (
    'Current project state (JSON):\n```json\n' +
    JSON.stringify(payload, null, 2) +
    '\n```\n\nUser message:\n' +
    userPrompt +
    '\n\nCall the `emit_response` tool with your reply (required) and any actions (possibly empty).'
  );
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<no body>';
  }
}
