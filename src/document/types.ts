// src/document/types.ts
// Public surface for the Week 6 documentation engine: LLM provider abstraction
// and documenter option types. HTTP plumbing, retries, timeouts live inside
// each provider implementation.

export type ProviderName = 'ollama' | 'openai' | 'anthropic' | 'groq' | 'mock';

export interface GenerateOptions {
  model: string;
  maxTokens: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface LLMProvider {
  readonly name: ProviderName;
  generate(prompt: string, opts: GenerateOptions): Promise<string>;
}

export type ProviderErrorKind =
  | 'unreachable'
  | 'rate-limited'
  | 'auth'
  | 'timeout'
  | 'malformed'
  | 'unknown';

export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface DocumenterOptions {
  provider: LLMProvider;
  model: string;
  tokenBudget: number;
  cacheDir: string | null;
  redactPatterns: string[];
  /** Map<absPath, originalContent> captured before run --apply wrote the new file. */
  originals: Map<string, string>;
}
