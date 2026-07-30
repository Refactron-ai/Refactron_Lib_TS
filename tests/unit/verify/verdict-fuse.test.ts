import { describe, it, expect } from 'vitest';
import {
  fuseVerdict,
  MISSING_TESTS_CAP,
  type CoverageAssessment,
} from '../../../src/verify/verdict-fuse.js';
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

  it('covered + flaky → UNPROVEN (SAFE disqualified), flaky reason, suspects surfaced', () => {
    // C1: a flaky heal is never a clean stable green. Even with the changed
    // lines covered — the only path that could otherwise reach SAFE — a test
    // that flipped on retry floors the verdict at UNPROVEN. Zero-false-SAFE.
    const r = fuseVerdict(passingWithFlaky(['test_flaky.py::test_flaky']), ['a.py'], covered);
    expect(r.verdict).toBe('UNPROVEN');
    expect(r.reason).toBe(
      'Tests pass, but 1 test(s) flipped on retry (flaky); a stable green could not be established.',
    );
    expect(r.flakyTests).toEqual(['test_flaky.py::test_flaky']);
  });

  it('covered + multiple flaky → count reflected in the flaky reason', () => {
    const r = fuseVerdict(passingWithFlaky(['a::x', 'b::y']), ['a.py'], covered);
    expect(r.verdict).toBe('UNPROVEN');
    expect(r.reason).toBe(
      'Tests pass, but 2 test(s) flipped on retry (flaky); a stable green could not be established.',
    );
  });

  it('unknown coverage + flaky → UNPROVEN, keeps the coverage reason, still carries flaky', () => {
    // Coverage already forces UNPROVEN, so the coverage reason wins the tie; the
    // flaky reason only pre-empts a would-be SAFE. Suspects still surface.
    const r = fuseVerdict(passingWithFlaky(['test_flaky.py::test_flaky']), ['a.ts'], unknown);
    expect(r.verdict).toBe('UNPROVEN');
    expect(r.reason).toMatch(/coverage of the changed code could not be determined/);
    expect(r.reason).not.toMatch(/flipped on retry/);
    expect(r.flakyTests).toEqual(['test_flaky.py::test_flaky']);
  });

  it('uncovered + flaky → UNPROVEN, keeps the coverage reason + missingTests, carries flaky', () => {
    const r = fuseVerdict(passingWithFlaky(['test_flaky.py::test_flaky']), ['a.py'], uncovered);
    expect(r.verdict).toBe('UNPROVEN');
    expect(r.reason).toMatch(/not exercised/);
    expect(r.reason).not.toMatch(/flipped on retry/);
    expect(r.missingTests?.[0]?.file).toBe('a.py');
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

  // The removal-only reason used to fire on "some removal-only file exists AND
  // the uncovered list is empty". Both halves are now much easier to satisfy, so
  // a MIXED diff — one removal-only file plus a file whose additions are fully
  // covered — printed "the change only removes code", which is simply false.
  it('does NOT claim removal-only when another changed file has real additions', () => {
    const mixed: CoverageAssessment = {
      tool: 'coverage.py',
      changedLinesCovered: false,
      uncovered: [],
      removalOnlyFiles: ['a.py'],
      // b.py contributed an inert-free, exercised statement, so it is in neither
      // bucket; the verdict is UNPROVEN for some other reason entirely.
    };
    const r = fuseVerdict(result(true), ['a.py', 'b.py'], mixed);
    expect(r.reason).not.toMatch(/only removes code/);
    expect(r.reason).toMatch(/not exercised/);
  });

  // The zero-check must read the PRE-CAP total. `uncovered` is capped, so
  // asking `uncovered.length === 0` asks "did any survive the cap?" when the
  // question is "were there any at all?".
  it('reads the pre-cap uncovered total, not the capped array length', () => {
    const capped: CoverageAssessment = {
      tool: 'coverage.py',
      changedLinesCovered: false,
      uncovered: [],
      uncoveredTruncated: { shown: 0, total: 12 },
      removalOnlyFiles: ['a.py'],
    };
    const r = fuseVerdict(result(true), ['a.py'], capped);
    expect(r.reason).not.toMatch(/only removes code/);
  });

  it('inert-only change → UNPROVEN naming comments and blank lines, not a coverage miss', () => {
    const inert: CoverageAssessment = {
      tool: 'coverage.py',
      changedLinesCovered: false,
      uncovered: [],
      inertOnlyFiles: ['a.py'],
    };
    const r = fuseVerdict(result(true), ['a.py'], inert);
    expect(r.verdict).toBe('UNPROVEN');
    expect(r.reason).toMatch(/comments and blank lines/);
    expect(r.reason).not.toMatch(/not exercised/);
    expect(r.missingTests).toBeUndefined();
  });

  it('removal-only AND inert-only together get a reason naming both', () => {
    const both: CoverageAssessment = {
      tool: 'coverage.py',
      changedLinesCovered: false,
      uncovered: [],
      removalOnlyFiles: ['a.py'],
      inertOnlyFiles: ['b.py'],
    };
    const r = fuseVerdict(result(true), ['a.py', 'b.py'], both);
    expect(r.reason).toMatch(/only removes code and touches comments and blank lines/);
  });

  // A statement coverage.py EXCLUDED cannot be reached by any test, so "add a
  // test exercising gated.py:6" is an uncompletable instruction that makes the
  // tool look broken.
  it('an excluded statement gets a review hint, never an add-a-test hint', () => {
    const excluded: CoverageAssessment = {
      tool: 'coverage.py',
      changedLinesCovered: false,
      uncovered: [
        { file: 'gated.py', line: 6, excluded: true },
        { file: 'plain.py', line: 9 },
      ],
    };
    const r = fuseVerdict(result(true), ['gated.py', 'plain.py'], excluded);
    expect(r.missingTests?.[0]?.hint).toContain('excluded from coverage');
    expect(r.missingTests?.[0]?.hint).not.toContain('add a test');
    expect(r.missingTests?.[1]?.hint).toBe('add a test exercising plain.py:9');
  });

  // The report is serialized verbatim by the MCP tool and by `--json`, so its
  // shape is a public contract the moment it ships.
  it('stamps reportVersion on every verdict', () => {
    expect(fuseVerdict(result(true), ['a.py'], covered).reportVersion).toBe(1);
    expect(fuseVerdict(result(true), ['a.py'], uncovered).reportVersion).toBe(1);
    expect(fuseVerdict(result(false, 'boom'), ['a.py'], unknown).reportVersion).toBe(1);
  });

  // Disclosure is not a verdict input. A SAFE change can still hold statements
  // no test ran, because SAFE clears on one exercised statement per changed file.
  it('carries uncovered and changedStatements through a SAFE verdict', () => {
    const partial: CoverageAssessment = {
      tool: 'coverage.py',
      changedLinesCovered: true,
      uncovered: [{ file: 'a.py', line: 30 }],
      changedStatements: { total: 2, covered: 1 },
    };
    const r = fuseVerdict(result(true), ['a.py'], partial);
    expect(r.verdict).toBe('SAFE');
    expect(r.coverage.uncovered).toEqual([{ file: 'a.py', line: 30 }]);
    expect(r.coverage.changedStatements).toEqual({ total: 2, covered: 1 });
    // Hints belong to the UNPROVEN path; SAFE discloses without instructing.
    expect(r.missingTests).toBeUndefined();
  });

  describe('missingTests cap', () => {
    // A 396-hunk reformat produced 3666 hints and an 883 KB JSON report. Nobody
    // reads 3666 hints, and no agent should have to stream them. Cap the list,
    // but say so in the data: a silently short list is a lie about the count.
    function uncoveredAt(n: number): CoverageAssessment {
      return {
        tool: 'coverage.py',
        changedLinesCovered: false,
        uncovered: Array.from({ length: n }, (_, i) => ({ file: 'a.py', line: i + 1 })),
      };
    }

    it('caps missingTests and reports the truncation explicitly', () => {
      const r = fuseVerdict(result(true), ['a.py'], uncoveredAt(MISSING_TESTS_CAP + 7));
      expect(r.missingTests).toHaveLength(MISSING_TESTS_CAP);
      expect(r.missingTestsTruncated).toEqual({
        shown: MISSING_TESTS_CAP,
        total: MISSING_TESTS_CAP + 7,
      });
    });

    it('omits the truncation signal when nothing was dropped', () => {
      const r = fuseVerdict(result(true), ['a.py'], uncoveredAt(3));
      expect(r.missingTests).toHaveLength(3);
      expect(r.missingTestsTruncated).toBeUndefined();
    });

    // When `coverage.uncovered` was ITSELF capped upstream, the hint total must
    // report the real number of uncovered statements, not the capped array
    // length: otherwise the truncation notice under-counts the shortfall.
    it('reports the pre-truncation total when uncovered was already capped', () => {
      const cov: CoverageAssessment = {
        ...uncoveredAt(MISSING_TESTS_CAP + 7),
        uncoveredTruncated: { shown: MISSING_TESTS_CAP + 7, total: 4231 },
      };
      const r = fuseVerdict(result(true), ['a.py'], cov);
      expect(r.missingTests).toHaveLength(MISSING_TESTS_CAP);
      expect(r.missingTestsTruncated).toEqual({ shown: MISSING_TESTS_CAP, total: 4231 });
    });
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
