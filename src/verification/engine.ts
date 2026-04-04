// src/verification/engine.ts
import type { ILanguageAdapter } from '../adapters/interface.js';
import type { BlastRadius, VerificationResult } from '../core/models.js';
import { SyntaxCheck } from './checks/syntax.js';
import { ImportsCheck } from './checks/imports.js';
import { TestGateCheck } from './checks/test-gate.js';
import { buildPassedResult, buildBlockedResult } from './result.js';

interface Check {
  name: string;
  run(
    filePath: string,
    code: string,
  ): Promise<{ passed: boolean; blockingReason?: string; durationMs: number }>;
}

export class VerificationEngine {
  private syntaxCheck: Check;
  private importsCheck: Check;

  constructor(
    private adapter: ILanguageAdapter,
    private criticalTimeoutMs = 120_000,
    private standardTimeoutMs = 45_000,
  ) {
    this.syntaxCheck = new SyntaxCheck(adapter);
    this.importsCheck = new ImportsCheck(adapter);
  }

  async verify(
    filePath: string,
    transformedCode: string,
    blastRadius: BlastRadius,
  ): Promise<VerificationResult> {
    const checks = this.selectChecks(blastRadius);
    const checksRun: string[] = [];
    const start = Date.now();

    for (const check of checks) {
      checksRun.push(check.name);
      const result = await check.run(filePath, transformedCode);
      if (!result.passed) {
        return buildBlockedResult(
          checksRun,
          check.name,
          result.blockingReason ?? `${check.name} failed`,
          Date.now() - start,
        );
      }
    }

    return buildPassedResult(checksRun, Date.now() - start);
  }

  private selectChecks(blast: BlastRadius): Check[] {
    const timeout =
      blast.level === 'critical' ? this.criticalTimeoutMs : this.standardTimeoutMs;
    const testGate = new TestGateCheck(this.adapter, timeout);

    if (blast.level === 'trivial') {
      return [this.syntaxCheck];
    }

    return [this.syntaxCheck, this.importsCheck, testGate];
  }
}
