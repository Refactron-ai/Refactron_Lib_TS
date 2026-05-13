// src/document/provider/anthropic.ts
// Cloud provider — opt-in. Uses native fetch with x-api-key header.
import {
  type LLMProvider,
  type GenerateOptions,
  type ProviderName,
  ProviderError,
} from '../types.js';

export interface AnthropicProviderOptions {
  apiKey: string;
}

interface AnthropicResponseBody {
  content?: Array<{ type?: string; text?: unknown }>;
}

export class AnthropicProvider implements LLMProvider {
  readonly name: ProviderName = 'anthropic';
  private readonly endpoint = 'https://api.anthropic.com/v1/messages';

  constructor(private readonly opts: AnthropicProviderOptions) {}

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
            'x-api-key': this.opts.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: opts.model,
            max_tokens: opts.maxTokens,
            temperature: opts.temperature ?? 0.2,
            messages: [{ role: 'user', content: prompt }],
          }),
          signal: controller.signal,
        });
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          throw new ProviderError('timeout', 'Anthropic request timed out');
        }
        throw new ProviderError('unreachable', 'Anthropic unreachable');
      }

      if (response.status === 401) {
        throw new ProviderError('auth', 'Anthropic rejected the API key');
      }
      if (response.status === 429) {
        throw new ProviderError('rate-limited', 'Anthropic rate-limited the request');
      }
      if (!response.ok) {
        throw new ProviderError('unknown', `Anthropic returned HTTP ${response.status}`);
      }

      let body: AnthropicResponseBody;
      try {
        body = (await response.json()) as AnthropicResponseBody;
      } catch {
        throw new ProviderError('malformed', 'Anthropic returned non-JSON');
      }

      const text = body.content?.[0]?.text;
      if (typeof text !== 'string') {
        throw new ProviderError('malformed', 'Anthropic response missing content[0].text');
      }
      return text;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }
}
