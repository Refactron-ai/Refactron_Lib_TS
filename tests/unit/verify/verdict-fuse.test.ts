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

describe('fuseVerdict flakyTests surface', () => {
  // The tests gate carries flakySuspects on the SAME object stored in
  // gates.tests (a verify-land extension, not a contract change). fuseVerdict
  // must lift it onto the report as flakyTests, without changing the verdict.
  function passingWithFlaky(flaky: string[]): VerificationResult {
    return {
      passed: true,
      gates: { syntax: ok, imports: ok, tests: { ...ok, flakySuspects: flaky } },
      writableChanges: [],
    } as VerificationResult;
  }

  it('lifts tests-gate flakySuspects onto report.flakyTests, verdict stays non-UNSAFE', () => {
    const r = fuseVerdict(passingWithFlaky(['test_flaky.py::test_flaky']), ['a.py'], covered);
    expect(r.verdict).not.toBe('UNSAFE');
    expect(r.flakyTests).toEqual(['test_flaky.py::test_flaky']);
  });

  it('omits flakyTests when the tests gate reports none', () => {
    const r = fuseVerdict(result(true), ['a.py'], covered);
    expect(r.flakyTests).toBeUndefined();
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

  it('removal-only change → UNPROVEN with a removal-specific reason, no missingTests', () => {
    // A diff that only deletes lines has no added lines for coverage to attest.
    // The old output was a bare "not exercised by any test" with an empty
    // uncovered list, which reads as a coverage miss rather than what it is.
    const removalOnly: CoverageAssessment = {
      tool: 'coverage.py',
      changedLinesCovered: false,
      uncovered: [],
      removalOnlyFiles: ['src/click/globals.py'],
    };
    const r = fuseVerdict(result(true), ['src/click/globals.py'], removalOnly);
    expect(r.verdict).toBe('UNPROVEN');
    expect(r.reason).toMatch(/only removes code/);
    expect(r.reason).not.toMatch(/not exercised/);
    expect(r.missingTests).toBeUndefined();
    expect(r.coverage.removalOnlyFiles).toEqual(['src/click/globals.py']);
  });

  it('mixed removal-only + uncovered additions keeps the coverage reason', () => {
    const mixed: CoverageAssessment = {
      tool: 'coverage.py',
      changedLinesCovered: false,
      uncovered: [{ file: 'b.py', line: 3 }],
      removalOnlyFiles: ['a.py'],
    };
    const r = fuseVerdict(result(true), ['a.py', 'b.py'], mixed);
    expect(r.verdict).toBe('UNPROVEN');
    expect(r.reason).toMatch(/not exercised/);
    expect(r.missingTests).toEqual([{ file: 'b.py', hint: 'add a test exercising b.py:3' }]);
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
