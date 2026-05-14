// src/document/provider/groq.ts
// Cloud provider — opt-in. Groq's API is OpenAI-compatible (same
// /v1/chat/completions endpoint shape, same request/response bodies, same
// bearer-auth header) so the implementation mirrors OpenAIProvider exactly
// — only the endpoint hostname and the env var name differ. We keep this
// as a separate class (rather than a parameterized OpenAIProvider) so the
// supported-providers list in pickProvider stays explicit and the error
// messages mention 'Groq' specifically when the API misbehaves.

import {
  type LLMProvider,
  type GenerateOptions,
  type ProviderName,
  ProviderError,
} from '../types.js';

export interface GroqProviderOptions {
  apiKey: string;
  /** Override the default Groq endpoint. Useful for proxies or self-hosted
   *  OpenAI-compatible servers. Defaults to Groq's hosted API. */
  endpoint?: string;
}

interface GroqResponseBody {
  choices?: Array<{ message?: { content?: unknown } }>;
}

const DEFAULT_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

export class GroqProvider implements LLMProvider {
  readonly name: ProviderName = 'groq';
  private readonly endpoint: string;

  constructor(private readonly opts: GroqProviderOptions) {
    this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  }

  async generate(prompt: string, opts: GenerateOptions): Promise<string> {
    const controller = new AbortController();
    const timer =
      opts.timeoutMs !== undefined ? setTimeout(() => controller.abort(), opts.timeoutMs) : null;

    try {
      let response: Response;
      try {
        response = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.opts.apiKey}`,
          },
          body: JSON.stringify({
            model: opts.model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: opts.maxTokens,
            temperature: opts.temperature ?? 0.2,
          }),
          signal: controller.signal,
        });
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          throw new ProviderError('timeout', 'Groq request timed out');
        }
        throw new ProviderError('unreachable', 'Groq unreachable');
      }

      if (response.status === 401) {
        throw new ProviderError('auth', 'Groq rejected the API key');
      }
      if (response.status === 429) {
        throw new ProviderError('rate-limited', 'Groq rate-limited the request');
      }
      if (!response.ok) {
        throw new ProviderError('unknown', `Groq returned HTTP ${response.status}`);
      }

      let body: GroqResponseBody;
      try {
        body = (await response.json()) as GroqResponseBody;
      } catch {
        throw new ProviderError('malformed', 'Groq returned non-JSON');
      }

      const text = body.choices?.[0]?.message?.content;
      if (typeof text !== 'string') {
        throw new ProviderError('malformed', 'Groq response missing message.content');
      }
      return text;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }
}
