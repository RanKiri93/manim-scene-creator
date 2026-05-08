import { createOpenAIProvider } from './openai';
import { createAnthropicProvider } from './anthropic';
import { createGeminiProvider } from './gemini';
import type { AgentProvider, ProviderConfig } from './types';

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
