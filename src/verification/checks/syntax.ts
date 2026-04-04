// src/verification/checks/syntax.ts
import type { ILanguageAdapter } from '../../adapters/interface.js';
import type { CheckResult } from '../../core/models.js';

export class SyntaxCheck {
  readonly name = 'syntax';

  constructor(private adapter: ILanguageAdapter) {}

  async run(filePath: string, code: string): Promise<CheckResult> {
    const start = Date.now();
    const result = await this.adapter.verifySyntax(filePath, code);
    return {
      ...result,
      durationMs: Date.now() - start,
    };
  }
}
