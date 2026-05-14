// src/document/provider/backend.ts
// Refactron's managed-LLM proxy. The user authenticates to refactron.dev
// (OAuth device flow OR REFACTRON_TOKEN env var) and we POST docstring
// prompts to the backend, which invokes whichever upstream LLM the
// account's plan allows. No direct LLM API key is needed.
//
// Wire shape (matches the legacy Python BackendLLMClient):
//   POST <api_base_url>/api/llm/generate
//   Headers:
//     Content-Type: application/json
//     Accept: application/json
//     X-API-Key: <api_key>          if creds.api_key is set
//     Authorization: Bearer <token> else if creds.access_token is set
//   Body:
//     { prompt, system, temperature, max_tokens, model }
//   Success (200): { content: "..." }
//   Error (non-200): if Content-Type=application/json, body {error: "..."} —
//                    else response text used as message.
//
// 401 → ProviderError('auth')   (refactron.dev rejected the credentials)
// 402 → ProviderError('auth', "...requires a Pro plan...")  (plan gating)
// 429 → ProviderError('rate-limited')

import {
  type LLMProvider,
  type GenerateOptions,
  type ProviderName,
  ProviderError,
} from '../types.js';

export interface BackendLLMProviderOptions {
  /** Defaults to https://api.refactron.dev. Trailing slash stripped. */
  apiBaseUrl?: string;
  /** Either api_key (preferred — sent as X-API-Key) ... */
  apiKey?: string | null;
  /** ... or access_token (sent as Authorization: Bearer). At least one required. */
  accessToken?: string | null;
}

interface BackendResponseBody {
  content?: unknown;
}

interface BackendErrorBody {
  error?: unknown;
}

const DEFAULT_BASE_URL = 'https://api.refactron.dev';

export class BackendLLMProvider implements LLMProvider {
  readonly name: ProviderName = 'backend';
  private readonly endpoint: string;
  private readonly apiKey: string | null;
  private readonly accessToken: string | null;

  constructor(opts: BackendLLMProviderOptions) {
    const base = (opts.apiBaseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.endpoint = `${base}/api/llm/generate`;
    this.apiKey = opts.apiKey ?? null;
    this.accessToken = opts.accessToken ?? null;
    if (this.apiKey === null && this.accessToken === null) {
      throw new Error(
        'BackendLLMProvider requires either api_key or access_token from Refactron credentials',
      );
    }
  }

  async generate(prompt: string, opts: GenerateOptions): Promise<string> {
    const controller = new AbortController();
    const timer =
      opts.timeoutMs !== undefined ? setTimeout(() => controller.abort(), opts.timeoutMs) : null;

    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'application/json',
      };
      if (this.apiKey !== null) {
        headers['x-api-key'] = this.apiKey;
      } else if (this.accessToken !== null) {
        headers.authorization = `Bearer ${this.accessToken}`;
      }

      let response: Response;
      try {
        response = await fetch(this.endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            prompt,
            system: null,
            temperature: opts.temperature ?? 0.2,
            max_tokens: opts.maxTokens,
            model: opts.model,
          }),
          signal: controller.signal,
        });
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          throw new ProviderError('timeout', 'Refactron backend request timed out');
        }
        throw new ProviderError('unreachable', 'Refactron backend unreachable');
      }

      if (response.status === 401) {
        throw new ProviderError('auth', 'Refactron backend rejected credentials');
      }
      if (response.status === 402) {
        // 402 Payment Required — backend says this requires a paid plan.
        const msg = await readBackendError(response);
        throw new ProviderError(
          'auth',
          msg !== null
            ? `Refactron backend: ${msg}`
            : 'documentation via backend proxy requires a Pro plan',
        );
      }
      if (response.status === 429) {
        throw new ProviderError('rate-limited', 'Refactron backend rate-limited the request');
      }
      if (!response.ok) {
        const msg = await readBackendError(response);
        throw new ProviderError(
          'unknown',
          `Refactron backend returned HTTP ${response.status}${msg !== null ? `: ${msg}` : ''}`,
        );
      }

      let body: BackendResponseBody;
      try {
        body = (await response.json()) as BackendResponseBody;
      } catch {
        throw new ProviderError('malformed', 'Refactron backend returned non-JSON');
      }

      const text = body.content;
      if (typeof text !== 'string') {
        throw new ProviderError('malformed', 'Refactron backend response missing .content');
      }
      return text;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }
}

async function readBackendError(response: Response): Promise<string | null> {
  // The backend may return either a JSON {error: "..."} body or plain text.
  // Match the legacy Python client's behavior: prefer the parsed `error` key.
  const ct = response.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    try {
      const body = (await response.json()) as BackendErrorBody;
      if (typeof body.error === 'string') return body.error;
    } catch {
      /* fall through */
    }
    return null;
  }
  try {
    return await response.text();
  } catch {
    return null;
  }
}
