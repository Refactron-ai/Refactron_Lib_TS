import { describe, it, expect } from 'vitest';
import { fuseVerdict, type CoverageAssessment } from '../../../src/verify/verdict-fuse.js';
import type { VerificationResult } from '../../../src/contracts.js';

const ok = { passed: true, durationMs: 1 };
function result(passed: boolean, testsReason?: string): VerificationResult {
  return {
    passed,
    gates: {
      syntax: ok,
      imports: ok,
      tests: passed
        ? ok
        : { passed: false, durationMs: 1, blockingReason: testsReason ?? 'tests failed' },
    },
    writableChanges: [],
  };
}
const covered: CoverageAssessment = {
  tool: 'coverage.py',
  changedLinesCovered: true,
  uncovered: [],
};
const uncovered: CoverageAssessment = {
  tool: 'coverage.py',
  changedLinesCovered: false,
  uncovered: [{ file: 'a.py', line: 5 }],
};
const unknown: CoverageAssessment = { tool: 'none', changedLinesCovered: 'unknown', uncovered: [] };

describe('fuseVerdict', () => {
  it('a failing gate → UNSAFE, surfacing the blocking reason', () => {
    const r = fuseVerdict(result(false, 'test_x broke'), ['a.py'], unknown);
    expect(r.verdict).toBe('UNSAFE');
    expect(r.reason).toContain('test_x broke');
  });
  it('tests pass + changed lines covered → SAFE', () => {
    expect(fuseVerdict(result(true), ['a.py'], covered).verdict).toBe('SAFE');
  });
  it('tests pass + changed lines uncovered → UNPROVEN with missingTests', () => {
    const r = fuseVerdict(result(true), ['a.py'], uncovered);
    expect(r.verdict).toBe('UNPROVEN');
    expect(r.missingTests?.[0]?.file).toBe('a.py');
  });
  it('tests pass + coverage unknown → UNPROVEN, never SAFE (fail-safe)', () => {
    expect(fuseVerdict(result(true), ['a.ts'], unknown).verdict).toBe('UNPROVEN');
  });
  it('no test runner detected → UNPROVEN, not UNSAFE (honest: nothing proven)', () => {
    const r = fuseVerdict(
      result(false, 'no test runner detected (pytest, vitest, jest); pass testCmd to override'),
      ['a.py'],
      unknown,
    );
    expect(r.verdict).toBe('UNPROVEN');
  });
  it('pre-existing baseline failure → UNPROVEN, not the diff breaking things', () => {
    const r = fuseVerdict(
      result(false, 'baseline tests already fail before refactoring; fix them first.'),
      ['a.py'],
      unknown,
    );
    expect(r.verdict).toBe('UNPROVEN');
  });
  it('tests fail after refactoring for a normal reason → still UNSAFE (remap not over-broad)', () => {
    const r = fuseVerdict(
      result(false, 'tests fail after refactoring: test_x broke'),
      ['a.py'],
      unknown,
    );
    expect(r.verdict).toBe('UNSAFE');
  });
});

describe('fuseVerdict — testFilesChanged note', () => {
  // A diff that weakens tests can otherwise ride a green verdict. We surface the
  // changed test files as a note (not a verdict change) so a reviewer sees it.
  it('flags changed files matching test conventions across languages', () => {
    const changed = [
      'src/attr/_make.py',
      'tests/test_make.py',
      'foo.spec.ts',
      'pkg/bar_test.py',
      'conftest.py',
      'ui/widget.test.ts',
    ];
    const r = fuseVerdict(result(true), changed, covered);
    expect(r.testFilesChanged).toEqual([
      'tests/test_make.py',
      'foo.spec.ts',
      'pkg/bar_test.py',
      'conftest.py',
      'ui/widget.test.ts',
    ]);
  });

  it('is empty when no changed file looks like a test', () => {
    const r = fuseVerdict(result(true), ['src/attr/_make.py', 'src/attr/_config.py'], covered);
    expect(r.testFilesChanged).toEqual([]);
  });

  it('flags tsx, js, and cjs/mjs test variants too', () => {
    const changed = ['ui/panel.test.tsx', 'lib/util.spec.js', 'lib/util.test.mjs', 'ui/panel.tsx'];
    const r = fuseVerdict(result(true), changed, covered);
    expect(r.testFilesChanged).toEqual([
      'ui/panel.test.tsx',
      'lib/util.spec.js',
      'lib/util.test.mjs',
    ]);
  });
});
