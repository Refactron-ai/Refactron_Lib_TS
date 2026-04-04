// tests/verification/blocks-bad-transform.test.ts
// Gate test: was FAILING in Week 1 (Task 4). Now GREEN using real VerificationEngine.

import { describe, it, expect } from 'vitest';
import { VerificationEngine } from '../../src/verification/engine.js';
import type { ILanguageAdapter } from '../../src/adapters/interface.js';
import type { BlastRadius, CheckResult } from '../../src/core/models.js';

const mediumBlast: BlastRadius = {
  affectedFiles: ['api/views.py', 'api/serializers.py'],
  affectedFunctions: ['get_user', 'list_users'],
  affectedTestFiles: ['tests/test_api.py'],
  score: 35,
  level: 'medium',
};

const trivialBlast: BlastRadius = {
  affectedFiles: [],
  affectedFunctions: [],
  affectedTestFiles: [],
  score: 0,
  level: 'trivial',
};

function makeAdapter(syntaxPass: boolean): ILanguageAdapter {
  return {
    name: 'python',
    extensions: ['.py'],
    displayName: 'Python',
    detect: async () => true,
    analyze: async () => [],
    transform: async (_f, _c, _i) => ({
      transformedCode: syntaxPass ? '# safe code' : '# mutated',
      description: '',
      riskLevel: syntaxPass ? 'low' : 'high',
    }),
    verifySyntax: async (): Promise<CheckResult> =>
      syntaxPass
        ? { passed: true, durationMs: 3 }
        : {
            passed: false,
            durationMs: 5,
            blockingReason: 'Return type changed from int to None — behavior change detected',
          },
    verifyImports: async (): Promise<CheckResult> => ({ passed: true, durationMs: 1 }),
    verifyTests: async (): Promise<CheckResult> => ({ passed: true, durationMs: 50 }),
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

describe('Verification Gate — blocks bad transforms, allows safe ones', () => {
  it('blocks a transform that changes function behavior (syntax fails)', async () => {
    const engine = new VerificationEngine(makeAdapter(false));
    const result = await engine.verify(
      'tests/fixtures/python/bad-transform.py',
      '# mutated code',
      mediumBlast,
    );
    expect(result.safeToApply).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.blockingReason).toContain('Return type changed');
  });

  it('allows a safe transform (unused import removal)', async () => {
    const engine = new VerificationEngine(makeAdapter(true));
    const result = await engine.verify(
      'tests/fixtures/python/safe-transform.py',
      '# safe code',
      trivialBlast,
    );
    expect(result.safeToApply).toBe(true);
    expect(result.passed).toBe(true);
  });
});
