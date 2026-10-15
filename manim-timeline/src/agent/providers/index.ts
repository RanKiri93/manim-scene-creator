import { createOpenAIProvider } from './openai';
import { createAnthropicProvider } from './anthropic';
import { createGeminiProvider } from './gemini';
import type { AgentProvider, ProviderConfig } from './types';
import type { LoopProvider } from '../loop/types';
import { createAnthropicLoopProvider } from './anthropicLoop';
import { createOpenAILoopProvider } from './openaiLoop';

export type { AgentProvider, ProviderConfig, ProviderId } from './types';
export { AgentProviderError } from './types';

/** Factory: instantiate a provider adapter from the current settings. */
export function getProvider(cfg: ProviderConfig): AgentProvider {
  switch (cfg.provider) {
    case 'openai':
      return createOpenAIProvider(cfg);
    case 'customOpenAI':
      return createOpenAIProvider(cfg);
    case 'anthropic':
      return createAnthropicProvider(cfg);
    case 'gemini':
      return createGeminiProvider(cfg);
    default:
      return createOpenAIProvider(cfg);
  }
}

/** Tool-loop adapter for providers that support it (Anthropic, OpenAI, OpenAI-compatible); else null. */
export function getLoopProvider(cfg: ProviderConfig): LoopProvider | null {
  switch (cfg.provider) {
    case 'anthropic':
      return createAnthropicLoopProvider(cfg);
    case 'openai':
    case 'customOpenAI':
      return createOpenAILoopProvider(cfg);
    default:
      return null;
  }
}
