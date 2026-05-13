import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAIProvider } from '../../../src/document/provider/openai.js';

const savedFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = savedFetch;
});

interface CapturedCall {
  url: unknown;
  init: { headers: Record<string, string>; body: string };
}

describe('OpenAIProvider', () => {
  it('sends bearer auth + chat completions body and returns content', async () => {
    let captured: CapturedCall | null = null;
    globalThis.fetch = vi.fn(async (url: unknown, init: CapturedCall['init']) => {
      captured = { url, init };
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'docstring text' } }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const p = new OpenAIProvider({ apiKey: 'sk-test' });
    const out = await p.generate('write docstring', {
      model: 'gpt-4o-mini',
      maxTokens: 256,
    });

    expect(out).toBe('docstring text');
    const c = captured as unknown as CapturedCall;
    expect(String(c.url)).toContain('/v1/chat/completions');
    expect(c.init.headers.authorization).toBe('Bearer sk-test');
    const body = JSON.parse(c.init.body) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      max_tokens: number;
    };
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages).toEqual([{ role: 'user', content: 'write docstring' }]);
    expect(body.max_tokens).toBe(256);
  });

  it('maps 401 to ProviderError(auth)', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 401 }),
    ) as unknown as typeof fetch;
    const p = new OpenAIProvider({ apiKey: 'bad' });
    await expect(p.generate('x', { model: 'm', maxTokens: 8 })).rejects.toMatchObject({
      kind: 'auth',
    });
  });

  it('maps 429 to ProviderError(rate-limited)', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 429 }),
    ) as unknown as typeof fetch;
    const p = new OpenAIProvider({ apiKey: 'k' });
    await expect(p.generate('x', { model: 'm', maxTokens: 8 })).rejects.toMatchObject({
      kind: 'rate-limited',
    });
  });

  it('throws ProviderError(malformed) when content field is missing', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    const p = new OpenAIProvider({ apiKey: 'k' });
    await expect(p.generate('x', { model: 'm', maxTokens: 8 })).rejects.toMatchObject({
      kind: 'malformed',
    });
  });

  it('respects timeoutMs via AbortSignal', async () => {
    globalThis.fetch = vi.fn(
      (_url: unknown, init: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    ) as unknown as typeof fetch;
    const p = new OpenAIProvider({ apiKey: 'k' });
    await expect(
      p.generate('x', { model: 'm', maxTokens: 8, timeoutMs: 20 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });
});
