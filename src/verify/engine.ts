import type {
  Verifier,
  RefactorPlan,
  VerificationResult,
  GateResult,
} from '../contracts.js';
import { createShadowTree } from './shadow-tree.js';
import { syntaxGate } from './gates/syntax.js';
import { importsGate } from './gates/imports.js';
import { testsGate, type TestsGateOptions } from './gates/tests.js';

export interface RefactronVerifierOptions {
  projectRoot: string;
  testCmd?: string;
  timeoutMs?: number;
}

export class RefactronVerifier implements Verifier {
  constructor(private readonly opts: RefactronVerifierOptions) {}

  async verify(plan: RefactorPlan): Promise<VerificationResult> {
    const handle = await createShadowTree(this.opts.projectRoot, plan.changes);
    try {
      const ctx = { shadowRoot: handle.path, changes: plan.changes };

      const syntax = await syntaxGate(ctx, this.opts.projectRoot);
      if (!syntax.passed) return this.fail({ syntax });

      const imports = await importsGate(ctx, this.opts.projectRoot);
      if (!imports.passed) return this.fail({ syntax, imports });

      const testsOpts: TestsGateOptions = {
        ...(this.opts.testCmd !== undefined ? { testCmd: this.opts.testCmd } : {}),
        ...(this.opts.timeoutMs !== undefined ? { timeoutMs: this.opts.timeoutMs } : {}),
      };
      const tests = await testsGate(ctx, this.opts.projectRoot, testsOpts);
      if (!tests.passed) return this.fail({ syntax, imports, tests });

      return {
        passed: true,
        gates: { syntax, imports, tests },
        writableChanges: plan.changes,
      };
    } finally {
      await handle.cleanup();
    }
  }

  private fail(gates: Partial<VerificationResult['gates']>): VerificationResult {
    const skipped: GateResult = {
      passed: false,
      durationMs: 0,
      blockingReason: 'skipped (earlier gate failed)',
    };
    return {
      passed: false,
      gates: {
        syntax: gates.syntax ?? skipped,
        imports: gates.imports ?? skipped,
        tests: gates.tests ?? skipped,
      },
      writableChanges: [],
    };
  }
}
