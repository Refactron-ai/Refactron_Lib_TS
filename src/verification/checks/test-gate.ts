// src/verification/checks/test-gate.ts
import type { ILanguageAdapter } from '../../adapters/interface.js';
import type { CheckResult } from '../../core/models.js';

export class TestGateCheck {
  readonly name = 'test-gate';

  constructor(
    private adapter: ILanguageAdapter,
    private timeoutMs: number = 45_000,
  ) {}

  async run(filePath: string, code: string): Promise<CheckResult> {
    const start = Date.now();

    const timeoutPromise = new Promise<CheckResult>((resolve) =>
      setTimeout(
        () =>
          resolve({
            passed: false,
            durationMs: this.timeoutMs,
            blockingReason: `Test gate timed out after ${this.timeoutMs}ms`,
          }),
        this.timeoutMs,
      ),
    );

    const checkPromise = this.adapter.verifyTests(filePath, code);
    const result = await Promise.race([checkPromise, timeoutPromise]);

    return {
      ...result,
      durationMs: Date.now() - start,
    };
  }
}
