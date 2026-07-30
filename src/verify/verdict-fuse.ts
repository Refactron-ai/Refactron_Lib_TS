// src/verify/verdict-fuse.ts
// Pure fusion of the verify engine's pass/fail gates with changed-line coverage
// into the honest three-way verdict. No I/O.
import type { VerificationResult, GateResult } from '../contracts.js';

export type Verdict = 'SAFE' | 'UNSAFE' | 'UNPROVEN';

export interface CoverageAssessment {
  tool: 'coverage.py' | 'none';
  changedLinesCovered: boolean | 'unknown';
  // One entry per UNEXECUTED enclosing statement (deduped), not per physical
  // line: coverage.py attributes execution to a statement's first line, so a
  // multi-line statement reports once, at a line a human can write a test for.
  // ALWAYS populated, including under a SAFE verdict. The per-file heuristic
  // clears SAFE on one exercised statement per file, so a SAFE change can still
  // contain statements no test ran; hiding them is what let a false SAFE pass
  // unnoticed. Disclosure never weakens a verdict, it only explains it.
  uncovered: Array<{ file: string; line: number; excluded?: boolean }>;
  // Present only when `uncovered` was capped. `total` is the true number of
  // uncovered statements; a short list without this field would misstate the gap.
  uncoveredTruncated?: { shown: number; total: number };
  // Distinct files with at least one uncovered statement, BEFORE any cap. The
  // cap can drop entries, so `{shown,total}` alone cannot tell the reader
  // whether whole files fell off the list.
  filesWithUncovered?: number;
  // Distinct changed statements and how many executed. A ratio ("12 of 40
  // changed statements exercised") the boolean cannot express. Additive and
  // advisory: it does NOT feed the verdict rule.
  changedStatements?: { total: number; covered: number };
  // Changed files whose edit only REMOVES lines: there are no added lines for
  // coverage to attest, which is a different situation from "the added code is
  // untested" and gets its own reason string.
  removalOnlyFiles?: string[];
  // Changed files whose added lines are ALL semantically inert (blank lines,
  // comment-only lines). Nothing to attest, same as removal-only: a deletion is
  // invisible in the added lines, so "provably inert edits" is not "provably
  // unchanged file".
  inertOnlyFiles?: string[];
}

export interface VerdictReport {
  // Schema version for this report. The MCP tool and `--json` serialize the
  // whole object verbatim, so its shape is a public contract; a consumer that
  // stores reports as fleet history needs to know which shape it is holding.
  // Bump on any breaking change to the fields below.
  reportVersion: 1;
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
  // Present only when `missingTests` was capped, carrying the true shortfall.
  missingTestsTruncated?: { shown: number; total: number };
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
/** Ceiling on `missingTests` hints. Truncation is always disclosed in
 *  `missingTestsTruncated`; silently dropping hints would misstate the gap. */
export const MISSING_TESTS_CAP = 50;

const NO_RUNNER_SUBSTRING = 'no test runner detected';
const BASELINE_RED_SUBSTRING = 'baseline tests already fail';

export function fuseVerdict(
  result: VerificationResult,
  changedFiles: string[],
  cov: CoverageAssessment,
): VerdictReport {
  const flakyTests = flakySuspectsOf(result.gates.tests);
  const base = {
    reportVersion: 1 as const,
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

  // Nothing-to-attest case: EVERY changed file either only deletes lines, or
  // changes nothing but comments and blank lines. Conservative UNPROVEN stands
  // (a deletion is invisible in the added lines, so a green suite proves nothing
  // about what left), but the reason must say what actually happened instead of
  // implying a coverage miss.
  //
  // Two things this predicate must get right. First, the zero-check reads the
  // PRE-CAP total: `uncovered` is capped, so a long list truncated to zero would
  // never happen today but the intent is "no uncovered statements at all", not
  // "none survived the cap". Second, it requires every changed file to be
  // accounted for. Checking only "some removal-only file exists" printed "the
  // change only removes code" for a MIXED diff (a removal-only file plus a file
  // with real, fully covered additions), which is simply false.
  const removalOnlyFiles = cov.removalOnlyFiles ?? [];
  const inertOnlyFiles = cov.inertOnlyFiles ?? [];
  const uncoveredTotal = cov.uncoveredTruncated?.total ?? cov.uncovered.length;
  const nothingToAttestFiles = new Set([...removalOnlyFiles, ...inertOnlyFiles]);
  const nothingToAttest =
    cov.changedLinesCovered === false &&
    uncoveredTotal === 0 &&
    nothingToAttestFiles.size > 0 &&
    changedFiles.every((f) => nothingToAttestFiles.has(f));
  const nothingToAttestReason =
    inertOnlyFiles.length === 0
      ? 'Tests pass. The change only removes code; there are no added lines for coverage to attest.'
      : removalOnlyFiles.length === 0
        ? 'Tests pass. The change only touches comments and blank lines; there are no added statements for coverage to attest.'
        : 'Tests pass. The change only removes code and touches comments and blank lines; there are no added statements for coverage to attest.';
  const coverageReason = nothingToAttest
    ? nothingToAttestReason
    : cov.changedLinesCovered === 'unknown'
      ? 'Tests pass, but coverage of the changed code could not be determined.'
      : 'Tests pass, but the changed code is not exercised by any test.';
  // Tie-break when both a flaky heal and a coverage shortfall could explain the
  // UNPROVEN: the flaky reason wins ONLY when coverage would otherwise have said
  // SAFE (changedLinesCovered === true). When coverage already forces UNPROVEN
  // ('unknown' or false), keep the coverage reason. flakyTests rides on `base`
  // in every branch, so the report always carries the suspects regardless.
  const reason = flakyReason && cov.changedLinesCovered === true ? flakyReason : coverageReason;
  // Cap the hint list. A mass reformat once emitted 3666 hints and an 883 KB
  // JSON report; nobody reads that, and no agent should have to stream it. The
  // shortfall is still reported in full via `missingTestsTruncated.total`, which
  // must reflect the count BEFORE any upstream capping of `cov.uncovered`;
  // otherwise the notice under-counts the gap it exists to disclose.
  const missingTests = cov.uncovered.slice(0, MISSING_TESTS_CAP).map((u) => ({
    file: u.file,
    // A statement coverage.py EXCLUDED (`# pragma: no cover`, `if
    // TYPE_CHECKING:`) is deliberately unreachable by the suite. Telling the
    // user to "add a test exercising" it hands them an uncompletable task and
    // makes the tool look broken; name the real situation instead.
    hint: u.excluded
      ? `${u.file}:${u.line} is excluded from coverage (e.g. \`# pragma: no cover\`, \`if TYPE_CHECKING:\`), so no test can exercise it; review this change by hand`
      : `add a test exercising ${u.file}:${u.line}`,
  }));
  const truncated = missingTests.length > 0 && uncoveredTotal > missingTests.length;
  return {
    verdict: 'UNPROVEN',
    ...base,
    reason,
    ...(missingTests.length > 0 ? { missingTests } : {}),
    ...(truncated
      ? { missingTestsTruncated: { shown: missingTests.length, total: uncoveredTotal } }
      : {}),
  };
}
