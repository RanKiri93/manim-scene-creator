import { AGENT_CHAT_RESPONSE_JSON_SCHEMA } from '../types';
import type { AgentChatMessage, AgentContextPayload } from '../types';
import {
  AgentProviderError,
  type AgentProvider,
  type ProviderConfig,
  type ProviderGenerateInput,
  type RawAgentResponse,
} from './types';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

/**
 * OpenAI Chat Completions provider that uses Structured Outputs via
 * `response_format: json_schema, strict: true`. Works against any
 * OpenAI-compatible endpoint when `baseUrl` is overridden.
 *
 * Full chat history is sent by re-emitting prior assistant turns as plain
 * assistant messages whose content is the JSON envelope the model produced
 * last time (`{"reply": "...", "actions": [...]}`). This keeps the model
 * anchored on the schema across turns. When the caller asks for thinking
 * mode and the selected model looks like an o-series / gpt-5 reasoning
 * model, we add `reasoning_effort` and — when available — read the provider's
 * reasoning summary into `thinking`.
 */
export function createOpenAIProvider(cfg: ProviderConfig): AgentProvider {
  const baseUrl = (cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = cfg.model || DEFAULT_MODEL;

  return {
    id: cfg.provider === 'customOpenAI' ? 'customOpenAI' : 'openai',
    async generate({
      payload,
      systemPrompt,
      history,
      userPrompt,
      includeThinking,
      signal,
    }: ProviderGenerateInput): Promise<RawAgentResponse> {
      if (!cfg.apiKey) {
        throw new AgentProviderError('OpenAI API key is not configured.');
      }

      const messages = buildChatMessages({
        systemPrompt,
        history,
        payload,
        userPrompt,
      });

      const wantReasoning = includeThinking && supportsReasoning(model);

      // NOTE: we intentionally do NOT enable `strict: true`. OpenAI's strict
      // Structured Outputs subset rejects:
      //   - `oneOf` (we use `anyOf`, but even `anyOf` needs unique first keys
      //     per-branch, which our discriminated union violates — all three
      //     branches lead with `action`).
      //   - `additionalProperties: true`, which we rely on inside `item` /
      //     `updates` so the model can emit arbitrary SceneItem fields.
      // Non-strict mode still steers the model at the schema; the TypeScript
      // validator in `validate.ts` enforces cross-action invariants either way.
      const body: Record<string, unknown> = {
        model,
        messages,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'AgentChatResponse',
            schema: AGENT_CHAT_RESPONSE_JSON_SCHEMA,
            strict: false,
          },
        },
      };
      if (wantReasoning) {
        body.reasoning_effort = 'medium';
      }

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        signal,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await safeText(res);
        throw new AgentProviderError(
          `OpenAI request failed (${res.status}): ${text}`,
          res.status,
        );
      }
      const data = (await res.json()) as {
        choices?: {
          message?: {
            content?: string;
            /** Some OpenAI-compatible endpoints surface reasoning here. */
            reasoning?: string | { summary?: string } | null;
            reasoning_content?: string;
          };
        }[];
      };
      const choice = data.choices?.[0]?.message;
      const content = choice?.content;
      if (typeof content !== 'string' || !content) {
        throw new AgentProviderError('OpenAI returned an empty completion.');
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(content) as Record<string, unknown>;
      } catch (e) {
        throw new AgentProviderError(
          `OpenAI returned non-JSON content: ${(e as Error).message}`,
        );
      }
      const reasoningText = extractReasoning(choice);
      if (reasoningText && typeof parsed === 'object' && parsed) {
        parsed.thinking = reasoningText;
      }
      return parsed;
    },
  };
}

function supportsReasoning(model: string): boolean {
  const m = model.toLowerCase();
  return (
    m.startsWith('o1') ||
    m.startsWith('o3') ||
    m.startsWith('o4') ||
    m.startsWith('gpt-5')
  );
}

function extractReasoning(
  choice:
    | {
        reasoning?: string | { summary?: string } | null;
        reasoning_content?: string;
      }
    | undefined,
): string | undefined {
  if (!choice) return undefined;
  if (typeof choice.reasoning_content === 'string' && choice.reasoning_content.trim()) {
    return choice.reasoning_content.trim();
  }
  const r = choice.reasoning;
  if (!r) return undefined;
  if (typeof r === 'string') return r.trim() || undefined;
  if (typeof r === 'object' && typeof r.summary === 'string' && r.summary.trim()) {
    return r.summary.trim();
  }
  return undefined;
}

interface BuildChatMessagesInput {
  systemPrompt: string;
  history: AgentChatMessage[];
  payload: AgentContextPayload;
  userPrompt: string;
}

function buildChatMessages(input: BuildChatMessagesInput): {
  role: 'system' | 'user' | 'assistant';
  content: string;
}[] {
  const out: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: input.systemPrompt },
  ];
  for (const m of input.history) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else {
      // Re-emit the assistant's prior turn in the same JSON envelope it was
      // supposed to produce, so the model stays on-schema across turns.
      // Superseded/rejected proposals are stripped so the model doesn't
      // think they were applied.
      const applied = m.actionsStatus === 'approved' ? (m.actions ?? []) : [];
      const noteSuffix =
        m.actionsStatus === 'rejected'
          ? '\n\n(Note: the user rejected the previous proposal; it was NOT applied.)'
          : m.actionsStatus === 'superseded'
            ? '\n\n(Note: the previous proposal was superseded by a newer reply; it was NOT applied.)'
            : '';
      out.push({
        role: 'assistant',
        content: JSON.stringify({
          reply: m.content + noteSuffix,
          actions: applied,
        }),
      });
    }
  }
  out.push({
    role: 'user',
    content: buildCurrentUserMessage(input.payload, input.userPrompt),
  });
  return out;
}

function buildCurrentUserMessage(
  payload: AgentContextPayload,
  userPrompt: string,
): string {
  return (
    'Current project state (JSON):\n' +
    '```json\n' +
    JSON.stringify(payload, null, 2) +
    '\n```\n\n' +
    'User message:\n' +
    userPrompt +
    '\n\n' +
    'Respond with a single JSON object matching the AgentChatResponse schema (`reply` required, `actions` possibly empty).'
  );
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<no body>';
  }
}
