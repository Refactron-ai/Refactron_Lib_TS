// src/verification/checks/imports.ts
import type { ILanguageAdapter } from '../../adapters/interface.js';
import type { CheckResult } from '../../core/models.js';

export class ImportsCheck {
  readonly name = 'imports';

  constructor(private adapter: ILanguageAdapter) {}

  async run(filePath: string, code: string): Promise<CheckResult> {
    const start = Date.now();
    const result = await this.adapter.verifyImports(filePath, code);
    return {
      ...result,
      durationMs: Date.now() - start,
    };
  }
}
