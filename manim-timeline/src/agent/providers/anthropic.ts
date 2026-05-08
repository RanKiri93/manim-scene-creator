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
const DEFAULT_MODEL = 'claude-3-5-sonnet-latest';
const ANTHROPIC_VERSION = '2023-06-01';
const THINKING_BUDGET_TOKENS = 4000;

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
  const model = cfg.model || DEFAULT_MODEL;

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
      const wantThinking = includeThinking && supportsExtendedThinking(model);

      const body: Record<string, unknown> = {
        model,
        max_tokens: wantThinking ? 4096 + THINKING_BUDGET_TOKENS : 4096,
        system: systemPrompt,
        tools: [
          {
            name: 'emit_response',
            description:
              'Emit the chat reply and the list of CREATE / UPDATE / DELETE actions (possibly empty) for this turn.',
            input_schema: AGENT_CHAT_RESPONSE_JSON_SCHEMA,
          },
        ],
        tool_choice: { type: 'tool', name: 'emit_response' },
        messages,
      };
      if (wantThinking) {
        body.thinking = {
          type: 'enabled',
          budget_tokens: THINKING_BUDGET_TOKENS,
        };
      }

      const res = await fetch(`${baseUrl}/messages`, {
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
      if (!res.ok) {
        const text = await safeText(res);
        throw new AgentProviderError(
          `Anthropic request failed (${res.status}): ${text}`,
          res.status,
        );
      }
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

function supportsExtendedThinking(model: string): boolean {
  const m = model.toLowerCase();
  // Claude 3.7+ and Claude 4 models support extended thinking.
  return (
    m.includes('claude-3-7') ||
    m.includes('claude-3.7') ||
    m.includes('claude-4') ||
    m.includes('claude-opus-4') ||
    m.includes('claude-sonnet-4')
  );
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
