// src/verify/verdict-fuse.ts
// Pure fusion of the verify engine's pass/fail gates with changed-line coverage
// into the honest three-way verdict. No I/O.
import type { VerificationResult, GateResult } from '../contracts.js';

export type Verdict = 'SAFE' | 'UNSAFE' | 'UNPROVEN';

export interface CoverageAssessment {
  tool: 'coverage.py' | 'none';
  changedLinesCovered: boolean | 'unknown';
  uncovered: Array<{ file: string; line: number }>;
}

export interface VerdictReport {
  verdict: Verdict;
  gates: { syntax: GateResult; imports: GateResult; tests: GateResult };
  changedFiles: string[];
  // Subset of changedFiles matching test conventions. A note, not a verdict
  // input: an agent that weakens tests can otherwise ride a green verdict, so we
  // surface which test files the diff touched without changing the verdict.
  testFilesChanged: string[];
  coverage: CoverageAssessment;
  reason: string;
  missingTests?: Array<{ file: string; hint: string }>;
}

// Changed-file paths (repo-relative, posix) that look like tests: a `tests/` or
// `test/` path segment, or a filename matching Python/TS test conventions.
function isTestFile(p: string): boolean {
  const parts = p.replace(/\\/g, '/').split('/');
  if (parts.includes('tests') || parts.includes('test')) return true;
  const base = parts[parts.length - 1] ?? '';
  return (
    base === 'conftest.py' ||
    /^test_.+\.py$/.test(base) ||
    /_test\.py$/.test(base) ||
    /\.test\.ts$/.test(base) ||
    /\.spec\.ts$/.test(base)
  );
}

// Stable substrings emitted by the tests gate (src/verify/gates/tests.ts) for
// the two "we cannot establish a verdict" cases. A tests-gate failure carrying
// either of these does NOT mean the diff broke anything — it means we could not
// prove anything at all — so it must map to UNPROVEN, never UNSAFE.
const NO_RUNNER_SUBSTRING = 'no test runner detected';
const BASELINE_RED_SUBSTRING = 'baseline tests already fail';

export function fuseVerdict(
  result: VerificationResult,
  changedFiles: string[],
  cov: CoverageAssessment,
): VerdictReport {
  const base = {
    gates: result.gates,
    changedFiles,
    testFilesChanged: changedFiles.filter(isTestFile),
    coverage: cov,
  };

  if (!result.passed) {
    const failedGate: 'syntax' | 'imports' | 'tests' = !result.gates.syntax.passed
      ? 'syntax'
      : !result.gates.imports.passed
        ? 'imports'
        : 'tests';
    const reason = result.gates[failedGate].blockingReason ?? `${failedGate} gate failed`;
    // "Cannot establish a verdict" case: syntax + imports both passed, and the
    // ONLY failure is the tests gate reporting no runner or an already-red
    // baseline. Neither is evidence the diff broke anything, so report UNPROVEN
    // (honest) rather than UNSAFE. A genuine syntax/imports failure, or a tests
    // failure for any other reason, still falls through to UNSAFE below.
    if (
      failedGate === 'tests' &&
      result.gates.syntax.passed &&
      result.gates.imports.passed &&
      (reason.includes(NO_RUNNER_SUBSTRING) || reason.includes(BASELINE_RED_SUBSTRING))
    ) {
      return { verdict: 'UNPROVEN', ...base, reason };
    }
    return { verdict: 'UNSAFE', ...base, reason };
  }

  if (cov.changedLinesCovered === true) {
    return {
      verdict: 'SAFE',
      ...base,
      reason: 'Tests pass and the changed code is covered.',
    };
  }

  const reason =
    cov.changedLinesCovered === 'unknown'
      ? 'Tests pass, but coverage of the changed code could not be determined.'
      : 'Tests pass, but the changed code is not exercised by any test.';
  const missingTests = cov.uncovered.map((u) => ({
    file: u.file,
    hint: `add a test exercising ${u.file}:${u.line}`,
  }));
  return {
    verdict: 'UNPROVEN',
    ...base,
    reason,
    ...(missingTests.length > 0 ? { missingTests } : {}),
  };
}
