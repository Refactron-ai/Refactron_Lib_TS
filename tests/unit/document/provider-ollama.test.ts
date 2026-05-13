import { describe, it, expect, vi, afterEach } from 'vitest';
import { OllamaProvider } from '../../../src/document/provider/ollama.js';

const savedFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = savedFetch;
});

describe('OllamaProvider', () => {
  it('posts {model, prompt, stream:false} to /api/generate and returns response.text', async () => {
    const calls: Array<{ url: unknown; init: { body: string } }> = [];
    globalThis.fetch = vi.fn(async (url: unknown, init: { body: string }) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ response: 'hello world' }), { status: 200 });
    }) as unknown as typeof fetch;

    const p = new OllamaProvider({ endpoint: 'http://localhost:11434' });
    const r = await p.generate('say hi', { model: 'llama3.1:8b', maxTokens: 64 });

    expect(r).toBe('hello world');
    expect(String(calls[0]!.url)).toBe('http://localhost:11434/api/generate');
    const body = JSON.parse(calls[0]!.init.body) as {
      model: string;
      prompt: string;
      stream: boolean;
      options: { num_predict: number };
    };
    expect(body).toMatchObject({ model: 'llama3.1:8b', prompt: 'say hi', stream: false });
    expect(body.options.num_predict).toBe(64);
  });

  it('throws ProviderError("unreachable") on network failure', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const p = new OllamaProvider({ endpoint: 'http://localhost:11434' });
    await expect(p.generate('x', { model: 'm', maxTokens: 8 })).rejects.toMatchObject({
      name: 'ProviderError',
      kind: 'unreachable',
    });
  });

  it('throws ProviderError("malformed") when JSON body is missing response', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('{}', { status: 200 }),
    ) as unknown as typeof fetch;
    const p = new OllamaProvider({ endpoint: 'http://localhost:11434' });
    await expect(p.generate('x', { model: 'm', maxTokens: 8 })).rejects.toMatchObject({
      kind: 'malformed',
    });
  });

  it('throws ProviderError("malformed") on non-JSON body', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('not json', { status: 200 }),
    ) as unknown as typeof fetch;
    const p = new OllamaProvider({ endpoint: 'http://localhost:11434' });
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
    const p = new OllamaProvider({ endpoint: 'http://localhost:11434' });
    await expect(
      p.generate('x', { model: 'm', maxTokens: 8, timeoutMs: 20 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });
});
