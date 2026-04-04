// tests/unit/verification-engine.test.ts
import { describe, it, expect } from 'vitest';
import { VerificationEngine } from '../../src/verification/engine.js';
import type { ILanguageAdapter } from '../../src/adapters/interface.js';
import type { BlastRadius, CheckResult } from '../../src/core/models.js';

const trivialBlast: BlastRadius = {
  affectedFiles: [],
  affectedFunctions: [],
  affectedTestFiles: [],
  score: 0,
  level: 'trivial',
};

const criticalBlast: BlastRadius = {
  affectedFiles: Array.from({ length: 30 }, (_, i) => `file${i}.py`),
  affectedFunctions: Array.from({ length: 60 }, (_, i) => `fn${i}`),
  affectedTestFiles: [],
  score: 82,
  level: 'critical',
};

function makeAdapter(
  syntaxPass: boolean,
  importsPass: boolean,
  testsPass: boolean,
): ILanguageAdapter {
  return {
    name: 'python',
    extensions: ['.py'],
    displayName: 'Python',
    detect: async () => true,
    analyze: async () => [],
    transform: async (_f, c, _i) => ({ transformedCode: c, description: '', riskLevel: 'low' }),
    verifySyntax: async (): Promise<CheckResult> =>
      syntaxPass
        ? { passed: true, durationMs: 5 }
        : { passed: false, durationMs: 5, blockingReason: 'syntax error' },
    verifyImports: async (): Promise<CheckResult> =>
      importsPass
        ? { passed: true, durationMs: 5 }
        : { passed: false, durationMs: 5, blockingReason: 'broken import' },
    verifyTests: async (): Promise<CheckResult> =>
      testsPass
        ? { passed: true, durationMs: 100 }
        : { passed: false, durationMs: 100, blockingReason: 'test_foo FAILED' },
    generateDiff: () => '',
    buildImportGraph: async () => ({
      dependentsOf: () => [],
      dependenciesOf: () => [],
      allFiles: () => [],
    }),
    buildCallGraph: async () => ({
      transitiveCallersOf: () => [],
      allPublicFunctionsIn: () => [],
    }),
  };
}

describe('VerificationEngine', () => {
  it('trivial blast: only runs syntax check', async () => {
    const engine = new VerificationEngine(makeAdapter(true, true, true));
    const result = await engine.verify('foo.py', 'code', trivialBlast);
    expect(result.passed).toBe(true);
    expect(result.checksRun).toEqual(['syntax']);
    expect(result.safeToApply).toBe(true);
  });

  it('critical blast: runs all 3 checks', async () => {
    const engine = new VerificationEngine(makeAdapter(true, true, true));
    const result = await engine.verify('foo.py', 'code', criticalBlast);
    expect(result.passed).toBe(true);
    expect(result.checksRun).toContain('syntax');
    expect(result.checksRun).toContain('imports');
    expect(result.checksRun).toContain('test-gate');
  });

  it('blocks when syntax fails', async () => {
    const engine = new VerificationEngine(makeAdapter(false, true, true));
    const result = await engine.verify('foo.py', 'code', trivialBlast);
    expect(result.passed).toBe(false);
    expect(result.safeToApply).toBe(false);
    expect(result.blockingReason).toContain('syntax error');
  });

  it('blocks when tests fail on critical blast', async () => {
    const engine = new VerificationEngine(makeAdapter(true, true, false));
    const result = await engine.verify('foo.py', 'code', criticalBlast);
    expect(result.passed).toBe(false);
    expect(result.blockingReason).toContain('test_foo FAILED');
  });
});
