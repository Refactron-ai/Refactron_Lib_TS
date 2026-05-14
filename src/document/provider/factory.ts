// src/document/provider/factory.ts
// Selects a concrete LLMProvider from configuration + environment. Cloud
// providers require their respective API keys to be present in the environment;
// missing keys raise with the exact env-var name in the message so callers can
// surface a helpful CLI error.
import type { LLMProvider } from '../types.js';
import type { RefactronCredentials } from '../../auth/credentials.js';
import { OllamaProvider } from './ollama.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { GroqProvider } from './groq.js';
import { BackendLLMProvider } from './backend.js';

export interface ProviderConfig {
  provider: 'ollama' | 'openai' | 'anthropic' | 'groq' | 'backend';
  model: string;
  endpoint: string | null;
}

export function pickProvider(
  cfg: ProviderConfig,
  env: NodeJS.ProcessEnv,
  creds: RefactronCredentials | null = null,
): LLMProvider {
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

  if (cfg.provider === 'backend') {
    if (creds === null) {
      throw new Error(
        "documentation.provider='backend' requires Refactron credentials — run `refactron login` " +
          'first or set REFACTRON_TOKEN',
      );
    }
    if (!creds.api_key && !creds.access_token) {
      throw new Error(
        "documentation.provider='backend' requires either api_key or access_token in your " +
          'Refactron credentials — run `refactron login` again',
      );
    }
    const opts: ConstructorParameters<typeof BackendLLMProvider>[0] = {
      apiBaseUrl: cfg.endpoint ?? creds.api_base_url,
      apiKey: creds.api_key,
      accessToken: creds.access_token,
    };
    return new BackendLLMProvider(opts);
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
