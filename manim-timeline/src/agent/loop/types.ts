import type { AgentChatMessage, AgentContextPayload } from '../types';

/** A tool the model can call, in provider-neutral form (JSON Schema input). */
export interface LoopToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LoopToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface LoopImage {
  mediaType: 'image/png' | 'image/jpeg';
  /** Base64 without the `data:` prefix. */
  base64: string;
}

export interface LoopToolResult {
  callId: string;
  /** Plain text (usually compact JSON) the model reads. */
  text: string;
  images?: LoopImage[];
  isError?: boolean;
}

/** One model response inside the loop. */
export interface LoopStep {
  text: string;
  thinking?: string;
  toolCalls: LoopToolCall[];
}

/** A running multi-call conversation with one provider. Holds that provider's wire messages. */
export interface LoopConversation {
  next(signal?: AbortSignal): Promise<LoopStep>;
  pushToolResults(results: LoopToolResult[]): void;
}

export interface LoopConversationInput {
  systemPrompt: string;
  history: AgentChatMessage[];
  payload: AgentContextPayload;
  userPrompt: string;
  tools: LoopToolSpec[];
  includeThinking: boolean;
}

/** Providers that can run the tool loop. */
export interface LoopProvider {
  startConversation(input: LoopConversationInput): LoopConversation;
}

/** One line of the visible work log for a turn. */
export interface LoopLogEntry {
  tool: string;
  summary: string;
  isError?: boolean;
}
