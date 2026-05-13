import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnthropicProvider } from '../../../src/document/provider/anthropic.js';

const savedFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = savedFetch;
});

interface CapturedCall {
  url: unknown;
  init: { headers: Record<string, string>; body: string };
}

describe('AnthropicProvider', () => {
  it('sends x-api-key + anthropic-version headers and reads content[0].text', async () => {
    let captured: CapturedCall | null = null;
    globalThis.fetch = vi.fn(async (url: unknown, init: CapturedCall['init']) => {
      captured = { url, init };
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'docstring' }] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const p = new AnthropicProvider({ apiKey: 'sk-ant-test' });
    const r = await p.generate('write doc', {
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 256,
    });

    expect(r).toBe('docstring');
    const c = captured as unknown as CapturedCall;
    expect(String(c.url)).toContain('/v1/messages');
    expect(c.init.headers['x-api-key']).toBe('sk-ant-test');
    expect(c.init.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(c.init.body) as {
      model: string;
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('claude-haiku-4-5-20251001');
    expect(body.max_tokens).toBe(256);
    expect(body.messages).toEqual([{ role: 'user', content: 'write doc' }]);
  });

  it('maps 401 to ProviderError(auth)', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 401 }),
    ) as unknown as typeof fetch;
    const p = new AnthropicProvider({ apiKey: 'bad' });
    await expect(p.generate('x', { model: 'm', maxTokens: 8 })).rejects.toMatchObject({
      kind: 'auth',
    });
  });

  it('maps 429 to ProviderError(rate-limited)', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 429 }),
    ) as unknown as typeof fetch;
    const p = new AnthropicProvider({ apiKey: 'k' });
    await expect(p.generate('x', { model: 'm', maxTokens: 8 })).rejects.toMatchObject({
      kind: 'rate-limited',
    });
  });

  it('throws ProviderError(malformed) when content array is missing text', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ content: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    const p = new AnthropicProvider({ apiKey: 'k' });
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
    const p = new AnthropicProvider({ apiKey: 'k' });
    await expect(
      p.generate('x', { model: 'm', maxTokens: 8, timeoutMs: 20 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });
});
