import { describe, it, expect, afterEach } from 'vitest';
import { pickProvider } from '../../../src/document/provider/factory.js';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

describe('pickProvider', () => {
  it('returns OllamaProvider by default', () => {
    const p = pickProvider(
      { provider: 'ollama', model: 'llama3.1:8b', endpoint: 'http://localhost:11434' },
      process.env,
    );
    expect(p.name).toBe('ollama');
  });

  it('returns OllamaProvider with default endpoint when endpoint is null', () => {
    const p = pickProvider(
      { provider: 'ollama', model: 'llama3.1:8b', endpoint: null },
      process.env,
    );
    expect(p.name).toBe('ollama');
  });

  it('returns OpenAIProvider when configured and OPENAI_API_KEY set', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const p = pickProvider(
      { provider: 'openai', model: 'gpt-4o-mini', endpoint: null },
      process.env,
    );
    expect(p.name).toBe('openai');
  });

  it('throws when openai configured without OPENAI_API_KEY', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() =>
      pickProvider({ provider: 'openai', model: 'gpt-4o-mini', endpoint: null }, process.env),
    ).toThrow(/OPENAI_API_KEY/);
  });

  it('returns AnthropicProvider when configured + ANTHROPIC_API_KEY set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    const p = pickProvider(
      {
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        endpoint: null,
      },
      process.env,
    );
    expect(p.name).toBe('anthropic');
  });

  it('throws when anthropic configured without ANTHROPIC_API_KEY', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() =>
      pickProvider(
        {
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
          endpoint: null,
        },
        process.env,
      ),
    ).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('returns GroqProvider when configured + GROQ_API_KEY set', () => {
    process.env.GROQ_API_KEY = 'gsk_test';
    const p = pickProvider(
      { provider: 'groq', model: 'llama-3.3-70b-versatile', endpoint: null },
      process.env,
    );
    expect(p.name).toBe('groq');
  });

  it('throws when groq configured without GROQ_API_KEY', () => {
    delete process.env.GROQ_API_KEY;
    expect(() =>
      pickProvider(
        { provider: 'groq', model: 'llama-3.3-70b-versatile', endpoint: null },
        process.env,
      ),
    ).toThrow(/GROQ_API_KEY/);
  });

  it('GroqProvider honors a custom endpoint when supplied (e.g. for proxies)', () => {
    process.env.GROQ_API_KEY = 'gsk_test';
    const p = pickProvider(
      {
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        endpoint: 'https://my-proxy.example.com/openai/v1/chat/completions',
      },
      process.env,
    );
    expect(p.name).toBe('groq');
  });
});
