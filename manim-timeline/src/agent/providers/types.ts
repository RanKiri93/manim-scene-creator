import type { AgentChatMessage, AgentContextPayload } from '../types';

/**
 * Raw provider response before validation. Individual providers are responsible
 * for parsing their wire format into this plain JSON shape, which the shared
 * validator then turns into a strict `AgentChatResponse`. The `thinking` field
 * is optional and only populated when the provider exposes reasoning summaries.
 */
export type RawAgentResponse = unknown;

export interface ProviderGenerateInput {
  /** Slim snapshot of scene state; attached to the latest user turn only. */
  payload: AgentContextPayload;
  systemPrompt: string;
  /**
   * Prior turns in the conversation, oldest-first, EXCLUDING the current
   * (latest) user turn which is passed separately as `userPrompt`.
   */
  history: AgentChatMessage[];
  /** The user's most recent natural-language message. */
  userPrompt: string;
  /**
   * If true, the caller wants us to opt in to any reasoning / thinking mode
   * the underlying model supports. Adapters MUST gracefully degrade (no-op)
   * on models that don't expose reasoning.
   */
  includeThinking: boolean;
  signal?: AbortSignal;
}

export interface AgentProvider {
  readonly id: ProviderId;
  generate(input: ProviderGenerateInput): Promise<RawAgentResponse>;
}

export type ProviderId = 'openai' | 'anthropic' | 'gemini' | 'customOpenAI';

/** Persisted settings shape; one active provider at a time. */
export interface ProviderConfig {
  provider: ProviderId;
  apiKey: string;
  /** Custom OpenAI-compatible base URL. Ignored for Anthropic; optional for OpenAI. */
  baseUrl: string;
  model: string;
}

export class AgentProviderError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AgentProviderError';
    this.status = status;
  }
}
