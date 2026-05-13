// src/document/provider/ollama.ts
// Default local provider. POSTs to /api/generate, no auth, expects {response}.
import {
  type LLMProvider,
  type GenerateOptions,
  type ProviderName,
  ProviderError,
} from '../types.js';

export interface OllamaProviderOptions {
  endpoint: string;
}

interface OllamaResponseBody {
  response?: unknown;
}

export class OllamaProvider implements LLMProvider {
  readonly name: ProviderName = 'ollama';

  constructor(private readonly opts: OllamaProviderOptions) {}

  async generate(prompt: string, opts: GenerateOptions): Promise<string> {
    const controller = new AbortController();
    const timer =
      opts.timeoutMs !== undefined ? setTimeout(() => controller.abort(), opts.timeoutMs) : null;

    try {
      let response: Response;
      try {
        response = await fetch(`${this.opts.endpoint}/api/generate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: opts.model,
            prompt,
            stream: false,
            options: {
              num_predict: opts.maxTokens,
              temperature: opts.temperature ?? 0.2,
            },
          }),
          signal: controller.signal,
        });
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          throw new ProviderError('timeout', 'Ollama request timed out');
        }
        throw new ProviderError('unreachable', `Ollama unreachable at ${this.opts.endpoint}`);
      }

      if (!response.ok) {
        throw new ProviderError('unknown', `Ollama returned HTTP ${response.status}`);
      }

      let body: OllamaResponseBody;
      try {
        body = (await response.json()) as OllamaResponseBody;
      } catch {
        throw new ProviderError('malformed', 'Ollama returned non-JSON');
      }

      const text = body.response;
      if (typeof text !== 'string') {
        throw new ProviderError('malformed', 'Ollama response missing .response field');
      }
      return text;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }
}
