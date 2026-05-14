// tests/unit/document/provider-backend.test.ts
// Refactron's managed-LLM proxy. Wire shape mirrors the legacy Python
// BackendLLMClient: POST /api/llm/generate with {prompt,system,temperature,
// max_tokens,model}, success body {content}, error body {error}.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BackendLLMProvider } from '../../../src/document/provider/backend.js';

const savedFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = savedFetch;
});

describe('BackendLLMProvider', () => {
  it('posts {prompt,system,temperature,max_tokens,model} to /api/llm/generate and returns content', async () => {
    let captured: { url: unknown; init: RequestInit } | null = null;
    globalThis.fetch = vi.fn(async (url, init) => {
      captured = { url, init: init as RequestInit };
      return new Response(JSON.stringify({ content: 'docstring text' }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new BackendLLMProvider({ apiKey: 'rfk_test' });
    const out = await p.generate('write a docstring', {
      model: 'llama-3.3-70b-versatile',
      maxTokens: 512,
    });
    expect(out).toBe('docstring text');
    expect(String(captured!.url)).toBe('https://api.refactron.dev/api/llm/generate');
    const body = JSON.parse(captured!.init.body as string);
    expect(body).toEqual({
      prompt: 'write a docstring',
      system: null,
      temperature: 0.2,
      max_tokens: 512,
      model: 'llama-3.3-70b-versatile',
    });
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers.accept).toBe('application/json');
  });

  it('prefers X-API-Key when api_key is set', async () => {
    let captured: { init: RequestInit } | null = null;
    globalThis.fetch = vi.fn(async (_url, init) => {
      captured = { init: init as RequestInit };
      return new Response(JSON.stringify({ content: 'ok' }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new BackendLLMProvider({ apiKey: 'rfk_test', accessToken: 'tok_should_be_ignored' });
    await p.generate('hi', { model: 'm', maxTokens: 8 });
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('rfk_test');
    expect(headers.authorization).toBeUndefined();
  });

  it('falls back to Authorization: Bearer when only access_token is set', async () => {
    let captured: { init: RequestInit } | null = null;
    globalThis.fetch = vi.fn(async (_url, init) => {
      captured = { init: init as RequestInit };
      return new Response(JSON.stringify({ content: 'ok' }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new BackendLLMProvider({ accessToken: 'tok_test' });
    await p.generate('hi', { model: 'm', maxTokens: 8 });
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok_test');
    expect(headers['x-api-key']).toBeUndefined();
  });

  it('throws synchronously when neither api_key nor access_token is provided', () => {
    expect(() => new BackendLLMProvider({})).toThrow(/api_key or access_token/);
  });

  it('honors custom apiBaseUrl + strips trailing slash', async () => {
    let captured: { url: unknown } | null = null;
    globalThis.fetch = vi.fn(async (url) => {
      captured = { url };
      return new Response(JSON.stringify({ content: 'ok' }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new BackendLLMProvider({
      apiKey: 'rfk',
      apiBaseUrl: 'https://staging.refactron.dev/',
    });
    await p.generate('hi', { model: 'm', maxTokens: 8 });
    expect(String(captured!.url)).toBe('https://staging.refactron.dev/api/llm/generate');
  });

  it('maps 401 → auth and 429 → rate-limited', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 401 }),
    ) as unknown as typeof fetch;
    const p = new BackendLLMProvider({ apiKey: 'bad' });
    await expect(p.generate('x', { model: 'm', maxTokens: 8 })).rejects.toMatchObject({
      kind: 'auth',
    });
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 429 }),
    ) as unknown as typeof fetch;
    await expect(p.generate('x', { model: 'm', maxTokens: 8 })).rejects.toMatchObject({
      kind: 'rate-limited',
    });
  });

  it('maps 402 → auth with a Pro-plan-specific message', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'plan upgrade required' }), {
          status: 402,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    const p = new BackendLLMProvider({ apiKey: 'rfk' });
    await expect(p.generate('x', { model: 'm', maxTokens: 8 })).rejects.toMatchObject({
      kind: 'auth',
      message: expect.stringMatching(/plan upgrade required/i),
    });
  });

  it('parses JSON error bodies for the message on non-OK responses', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'invalid key' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    const p = new BackendLLMProvider({ apiKey: 'rfk' });
    await expect(p.generate('x', { model: 'm', maxTokens: 8 })).rejects.toMatchObject({
      kind: 'unknown',
      message: expect.stringMatching(/invalid key/),
    });
  });

  it('throws ProviderError("malformed") when response JSON has no .content', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('{}', { status: 200 }),
    ) as unknown as typeof fetch;
    const p = new BackendLLMProvider({ apiKey: 'rfk' });
    await expect(p.generate('x', { model: 'm', maxTokens: 8 })).rejects.toMatchObject({
      kind: 'malformed',
    });
  });

  it('honors timeoutMs via AbortSignal', async () => {
    globalThis.fetch = vi.fn(
      (_url: unknown, init: RequestInit | undefined) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    ) as unknown as typeof fetch;
    const p = new BackendLLMProvider({ apiKey: 'rfk' });
    await expect(
      p.generate('x', { model: 'm', maxTokens: 8, timeoutMs: 50 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });
});
