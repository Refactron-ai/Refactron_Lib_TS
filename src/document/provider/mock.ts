// src/document/provider/mock.ts
// Deterministic LLM provider used by tests, integration and e2e. The responder
// is a pure function from prompt to canned response text.
import type { LLMProvider, GenerateOptions, ProviderName } from '../types.js';

export class MockLLMProvider implements LLMProvider {
  readonly name: ProviderName = 'mock';

  constructor(private readonly responder: (prompt: string) => string) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async generate(prompt: string, _opts: GenerateOptions): Promise<string> {
    return this.responder(prompt);
  }
}
