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

/** What a streamed model response has said so far (text, and the `finish` reply as it is written). */
export interface LoopPartial {
  text: string;
  reply?: string;
}

/** A running multi-call conversation with one provider. Holds that provider's wire messages. */
export interface LoopConversation {
  /** One model call. With `onPartial` (and a provider that streams) it reports text as it arrives. */
  next(signal?: AbortSignal, onPartial?: (partial: LoopPartial) => void): Promise<LoopStep>;
  pushToolResults(results: LoopToolResult[]): void;
}

export interface LoopConversationInput {
  systemPrompt: string;
  history: AgentChatMessage[];
  payload: AgentContextPayload;
  userPrompt: string;
  tools: LoopToolSpec[];
  includeThinking: boolean;
  /** Stream responses where the provider supports it (Anthropic, OpenAI). */
  stream?: boolean;
}

/** Providers that can run the tool loop. */
export interface LoopProvider {
  startConversation(input: LoopConversationInput): LoopConversation;
}

/** A picture the Copilot looked at, kept small for its Steps list. */
export interface LoopSeenImage {
  /** JPEG data URL, about 160 px wide. */
  src: string;
  /** Scene time of the picture (click jumps the playhead there). */
  time: number;
  source: 'preview' | 'manim';
}

/** One line of the visible work log for a turn. */
export interface LoopLogEntry {
  tool: string;
  summary: string;
  isError?: boolean;
  image?: LoopSeenImage;
}
