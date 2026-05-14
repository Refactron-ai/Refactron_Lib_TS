// src/document/provider/factory.ts
// Selects a concrete LLMProvider from configuration + environment. Cloud
// providers require their respective API keys to be present in the environment;
// missing keys raise with the exact env-var name in the message so callers can
// surface a helpful CLI error.
import type { LLMProvider } from '../types.js';
import { OllamaProvider } from './ollama.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { GroqProvider } from './groq.js';

export interface ProviderConfig {
  provider: 'ollama' | 'openai' | 'anthropic' | 'groq';
  model: string;
  endpoint: string | null;
}

export function pickProvider(cfg: ProviderConfig, env: NodeJS.ProcessEnv): LLMProvider {
  if (cfg.provider === 'ollama') {
    return new OllamaProvider({
      endpoint: cfg.endpoint ?? 'http://localhost:11434',
    });
  }

  if (cfg.provider === 'openai') {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("documentation.provider='openai' requires OPENAI_API_KEY in the environment");
    }
    return new OpenAIProvider({ apiKey });
  }

  if (cfg.provider === 'groq') {
    const apiKey = env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("documentation.provider='groq' requires GROQ_API_KEY in the environment");
    }
    return new GroqProvider(cfg.endpoint ? { apiKey, endpoint: cfg.endpoint } : { apiKey });
  }

  // anthropic
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "documentation.provider='anthropic' requires ANTHROPIC_API_KEY in the environment",
    );
  }
  return new AnthropicProvider({ apiKey });
}
