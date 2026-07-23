// src/verify/verdict-fuse.ts
// Pure fusion of the verify engine's pass/fail gates with changed-line coverage
// into the honest three-way verdict. No I/O.
import type { VerificationResult, GateResult } from '../contracts.js';

export type Verdict = 'SAFE' | 'UNSAFE' | 'UNPROVEN';

export interface CoverageAssessment {
  tool: 'coverage.py' | 'none';
  changedLinesCovered: boolean | 'unknown';
  uncovered: Array<{ file: string; line: number }>;
  // Changed files whose edit only REMOVES lines: there are no added lines for
  // coverage to attest, which is a different situation from "the added code is
  // untested" and gets its own reason string.
  removalOnlyFiles?: string[];
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
  // Tests that failed once in the changed shadow then passed on a same-shadow
  // retry. The tests gate treated them as flaky rather than blaming the diff; we
  // surface them so the human/JSON report can note them. Not a verdict input.
  flakyTests?: string[];
}

// The tests gate carries flakySuspects on the SAME object it returns as the
// tests GateResult (a verify-land extension; GateResult itself is locked). Read
// it back structurally here without importing from the locked contract or
// widening it.
function flakySuspectsOf(tests: GateResult): string[] | undefined {
  const suspects = (tests as { flakySuspects?: unknown }).flakySuspects;
  return Array.isArray(suspects) && suspects.length > 0 ? (suspects as string[]) : undefined;
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
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(base)
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
  const flakyTests = flakySuspectsOf(result.gates.tests);
  const base = {
    gates: result.gates,
    changedFiles,
    testFilesChanged: changedFiles.filter(isTestFile),
    coverage: cov,
    ...(flakyTests ? { flakyTests } : {}),
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

  // C1 (zero-false-SAFE): a flaky heal is never a clean stable green. If any
  // test flipped on retry, no stable green was ever observed, so SAFE is
  // disqualified and the verdict floors at UNPROVEN below. Its reason pre-empts
  // the would-be-SAFE reason only; when coverage already forces UNPROVEN, the
  // coverage reason stands (see the tie-break comment below).
  const flakyReason = flakyTests
    ? `Tests pass, but ${flakyTests.length} test(s) flipped on retry (flaky); a stable green could not be established.`
    : null;

  if (cov.changedLinesCovered === true && !flakyReason) {
    return {
      verdict: 'SAFE',
      ...base,
      reason: 'Tests pass and the changed code is covered.',
    };
  }

  // Pure-removal case: every changed file only deletes lines, so there is
  // nothing new for coverage to attest. Conservative UNPROVEN stands (removing
  // uncovered behavior would go unnoticed by a green suite), but the reason
  // must say what actually happened instead of implying a coverage miss.
  const removalOnly =
    cov.changedLinesCovered === false &&
    cov.uncovered.length === 0 &&
    (cov.removalOnlyFiles?.length ?? 0) > 0;
  const coverageReason = removalOnly
    ? 'Tests pass. The change only removes code; there are no added lines for coverage to attest.'
    : cov.changedLinesCovered === 'unknown'
      ? 'Tests pass, but coverage of the changed code could not be determined.'
      : 'Tests pass, but the changed code is not exercised by any test.';
  // Tie-break when both a flaky heal and a coverage shortfall could explain the
  // UNPROVEN: the flaky reason wins ONLY when coverage would otherwise have said
  // SAFE (changedLinesCovered === true). When coverage already forces UNPROVEN
  // ('unknown' or false), keep the coverage reason. flakyTests rides on `base`
  // in every branch, so the report always carries the suspects regardless.
  const reason = flakyReason && cov.changedLinesCovered === true ? flakyReason : coverageReason;
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
