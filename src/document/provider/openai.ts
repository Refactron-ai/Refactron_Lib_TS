// src/document/provider/openai.ts
// Cloud provider — opt-in. Uses native fetch with bearer auth.
import {
  type LLMProvider,
  type GenerateOptions,
  type ProviderName,
  ProviderError,
} from '../types.js';

export interface OpenAIProviderOptions {
  apiKey: string;
}

interface OpenAIResponseBody {
  choices?: Array<{ message?: { content?: unknown } }>;
}

export class OpenAIProvider implements LLMProvider {
  readonly name: ProviderName = 'openai';
  private readonly endpoint = 'https://api.openai.com/v1/chat/completions';

  constructor(private readonly opts: OpenAIProviderOptions) {}

  async generate(prompt: string, opts: GenerateOptions): Promise<string> {
    const controller = new AbortController();
    const timer =
      opts.timeoutMs !== undefined
        ? setTimeout(() => controller.abort(), opts.timeoutMs)
        : null;

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
          throw new ProviderError('timeout', 'OpenAI request timed out');
        }
        throw new ProviderError('unreachable', 'OpenAI unreachable');
      }

      if (response.status === 401) {
        throw new ProviderError('auth', 'OpenAI rejected the API key');
      }
      if (response.status === 429) {
        throw new ProviderError('rate-limited', 'OpenAI rate-limited the request');
      }
      if (!response.ok) {
        throw new ProviderError('unknown', `OpenAI returned HTTP ${response.status}`);
      }

      let body: OpenAIResponseBody;
      try {
        body = (await response.json()) as OpenAIResponseBody;
      } catch {
        throw new ProviderError('malformed', 'OpenAI returned non-JSON');
      }

      const text = body.choices?.[0]?.message?.content;
      if (typeof text !== 'string') {
        throw new ProviderError('malformed', 'OpenAI response missing message.content');
      }
      return text;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }
}
