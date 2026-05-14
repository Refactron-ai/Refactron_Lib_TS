// tests/unit/document/provider-groq.test.ts
// Groq's API is OpenAI-compatible, so the test surface mirrors
// provider-openai.test.ts: bearer-auth, /chat/completions endpoint shape,
// 401 → auth, 429 → rate-limited.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { GroqProvider } from '../../../src/document/provider/groq.js';

const savedFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = savedFetch;
});

describe('GroqProvider', () => {
  it('sends bearer auth + chat completions body to the Groq endpoint and returns content', async () => {
    let captured: { url: unknown; init: RequestInit } | null = null;
    globalThis.fetch = vi.fn(async (url, init) => {
      captured = { url, init: init as RequestInit };
      return new Response(JSON.stringify({ choices: [{ message: { content: 'doc text' } }] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const p = new GroqProvider({ apiKey: 'gsk_test' });
    const out = await p.generate('write doc', { model: 'llama-3.3-70b-versatile', maxTokens: 256 });
    expect(out).toBe('doc text');
    expect(String(captured!.url)).toContain('groq.com/openai/v1/chat/completions');
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer gsk_test');
    const body = JSON.parse(captured!.init.body as string);
    expect(body.model).toBe('llama-3.3-70b-versatile');
    expect(body.messages).toEqual([{ role: 'user', content: 'write doc' }]);
    expect(body.max_tokens).toBe(256);
  });

  it('honors a custom endpoint override (proxies, self-hosted)', async () => {
    let captured: { url: unknown } | null = null;
    globalThis.fetch = vi.fn(async (url) => {
      captured = { url };
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const p = new GroqProvider({
      apiKey: 'gsk_test',
      endpoint: 'https://my-proxy.example.com/v1/chat/completions',
    });
    await p.generate('hi', { model: 'm', maxTokens: 8 });
    expect(String(captured!.url)).toBe('https://my-proxy.example.com/v1/chat/completions');
  });

  it('maps 401 → auth and 429 → rate-limited', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 401 }),
    ) as unknown as typeof fetch;
    const p = new GroqProvider({ apiKey: 'bad' });
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

  it('maps fetch failure → unreachable', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const p = new GroqProvider({ apiKey: 'gsk_test' });
    await expect(p.generate('x', { model: 'm', maxTokens: 8 })).rejects.toMatchObject({
      kind: 'unreachable',
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
    const p = new GroqProvider({ apiKey: 'gsk_test' });
    await expect(
      p.generate('x', { model: 'm', maxTokens: 8, timeoutMs: 50 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });
});
