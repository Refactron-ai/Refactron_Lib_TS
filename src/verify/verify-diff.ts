// src/verify/verify-diff.ts
// Verify an arbitrary diff Refactron did NOT author. Composes the existing
// RefactronVerifier (pass/fail gates) with reportCoverage (changed-line
// coverage, Python only) into a SAFE/UNSAFE/UNPROVEN verdict. Read-only:
// never mutates the caller's repo.
import * as path from 'node:path';
import { RefactronVerifier } from './engine.js';
import { createShadowTree } from './shadow-tree.js';
import { reportCoverage, normalizePath } from '../analyze/coverage/index.js';
import { attributeChangedLines } from './coverage-attribution.js';
import { buildStatementMap } from './statement-map.js';
import { fuseVerdict, type CoverageAssessment, type VerdictReport } from './verdict-fuse.js';
import { assessTestScope } from './test-scope.js';
import { ENGINE_VERSION } from '../engine-version.js';
import { changedLinesForEdits, editsFromUnifiedDiff, type FileEdit } from './diff-input.js';
import type { FileChange, RefactorPlan, TransformId } from '../contracts.js';

export interface VerifyDiffInput {
  repoRoot: string;
  edits?: FileEdit[];
  unifiedDiff?: string;
  testCmd?: string;
  timeoutMs?: number;
}

// Inert at verify time (keystone spike: transformId/oldHash are never read).
const SYNTHETIC_TRANSFORM = 'external-diff' as unknown as TransformId;

// FileEdit paths are repo-relative, but the shadow tree keys off
// `path.relative(sourceRoot, change.path)` and rejects anything that escapes
// the root. A bare relative path is resolved against process.cwd(), which is
// rarely the repo root — so we resolve it against `repoRoot` here, matching the
// absolute-path convention the verify engine already uses for FileChange.
function toChanges(repoRoot: string, edits: FileEdit[]): FileChange[] {
  return edits.map((e) => ({
    path: path.resolve(repoRoot, e.path),
    oldHash: '',
    newContent: e.newContent,
    transformId: SYNTHETIC_TRANSFORM,
  }));
}

// The caller passes ONE full shell command. RefactronVerifier runs it verbatim
// via `sh -c`; reportCoverage decides for itself how to wrap it for `coverage
// run` (see toCoverageRunArgs). This module deliberately does no pre-mangling:
// the old `python -m ` strip destroyed script-form commands such as Django's
// `python3 tests/runtests.py`, which then measured no coverage at all.

export async function verifyDiff(input: VerifyDiffInput): Promise<VerdictReport> {
  const edits =
    input.edits ??
    (input.unifiedDiff ? await editsFromUnifiedDiff(input.repoRoot, input.unifiedDiff) : []);
  if (edits.length === 0) {
    throw new Error('verifyDiff: no edits provided (pass `edits` or `unifiedDiff`)');
  }
  const changedFiles = edits.map((e) => e.path);

  // 1. Gates (pass/fail) — the existing verifier manages its own shadow tree.
  const verifier = new RefactronVerifier({
    projectRoot: input.repoRoot,
    ...(input.testCmd ? { testCmd: input.testCmd } : {}),
    ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
  });
  const result = await verifier.verify({
    changes: toChanges(input.repoRoot, edits),
    preconditions: [],
  } as RefactorPlan);

  // 2. Coverage (only when gates pass; Python only).
  let cov: CoverageAssessment = unknownCoverage();
  if (result.passed) {
    cov = await assessCoverage(input, edits);
  }

  // 3. Fuse. The scope of the run is a verdict input, not a note: a green run of
  // a caller-chosen subset cannot earn SAFE (issue #110, ADR-12).
  //
  // engineVersion is stamped HERE rather than inside fuseVerdict, which
  // documents itself as pure with no I/O. This is already the I/O layer.
  return {
    ...fuseVerdict(result, changedFiles, cov, assessTestScope(input.testCmd, process.env)),
    engineVersion: ENGINE_VERSION,
  };
}

/** Coverage we could not establish. A fresh object each time: callers own it.
 *  Never a shared literal, and never "covered": every degradation path in
 *  assessCoverage lands here, and reporting an unmeasured change as covered
 *  would be a false SAFE. */
function unknownCoverage(reason?: string): CoverageAssessment {
  return {
    tool: 'none',
    changedLinesCovered: 'unknown',
    uncovered: [],
    ...(reason ? { unknownReason: reason } : {}),
  };
}

async function assessCoverage(
  input: VerifyDiffInput,
  edits: FileEdit[],
): Promise<CoverageAssessment> {
  const pyEdits = edits.filter((e) => e.path.endsWith('.py'));
  // Coverage is Python-only. If ANY edit is non-Python (or there are no Python
  // edits at all), we cannot assess the WHOLE change. Reporting "covered" here
  // would silently pass an unverified non-Python change through as SAFE — a
  // false SAFE, which is forbidden. Bail to 'unknown' (→ UNPROVEN) unless every
  // edit is a `.py` file we can actually assess.
  if (pyEdits.length !== edits.length || pyEdits.length === 0) {
    return unknownCoverage();
  }
  const shadow = await createShadowTree(input.repoRoot, toChanges(input.repoRoot, edits));
  try {
    const report = await reportCoverage({
      projectRoot: shadow.path,
      ...(input.testCmd ? { testCmd: input.testCmd } : {}),
    });
    // No tool, or a measurement we could not actually perform, both mean the
    // same thing: coverage is UNKNOWN. Reporting an unmeasured empty set as
    // "not exercised by any test" would be a confident lie about the suite.
    if (!report.coverageToolFound || report.measurementFailed) {
      // Carry the reason. `reportCoverage` knows exactly why it could not
      // measure ("cannot wrap test command for coverage: ..."), and
      // tool-reference.mdx promises agents that `coverage.unknownReason` says
      // why coverage is unknown when we know. Dropping it here reproduced the
      // very failure this file guards against: a silent UNPROVEN that looks
      // identical whether the wrapper declined the command or the suite simply
      // never touched the code. Absent when we genuinely have no reason.
      return unknownCoverage(report.measurementFailureReason);
    }
    const ranges = await changedLinesForEdits(input.repoRoot, pyEdits);
    // Shadow-bypass guard. If a changed file was never MEASURED at all, the
    // suite never loaded our copy of it. The usual cause is the project being
    // pip-installed (editable or not) so `import pkg` resolves to the installed
    // copy instead of the tree under verification, meaning the tests ran the
    // ORIGINAL code and this run proves nothing about the change. Proven on
    // django: without the shadow root on sys.path the same diff read UNPROVEN
    // while with it the auth suite caught the change. Report unknown, never
    // "not exercised by any test".
    const unmeasured = ranges.filter(
      (r) => r.lines.length > 0 && !report.measuredFiles.has(normalizePath(r.path)),
    );
    if (unmeasured.length > 0) {
      // Say WHY, and say what fixes it. This is the dominant degradation path
      // for a project whose tests import an installed copy, and a bare "could
      // not be determined" leaves the user with no idea that a one-line change
      // to their test command would give them a real verdict. The remedy is
      // documented at verdicts.mdx "Make sure the tests run the code being
      // verified", but nobody who lands here has a reason to go read it.
      const names = unmeasured.map((r) => r.path).join(', ');
      return unknownCoverage(
        `the test run never imported ${names}, so the suite exercised a different copy ` +
          `than the one being verified (usually an installed or editable package). ` +
          `Put the verified tree first on sys.path, for example by prefixing the test ` +
          `command with PYTHONPATH=. (or PYTHONPATH=src for a src layout).`,
      );
    }
    // Judge coverage on STATEMENTS, not physical lines, using real extents from
    // the Python AST. coverage.py only ever marks a statement's FIRST line, so a
    // diff that rewraps statements (any formatter) would otherwise report every
    // continuation line as uncovered. The cheap repair of walking back to
    // the nearest statement start above the line is unsound, because it cannot
    // tell a continuation line from a blank/comment/dead-branch line that merely
    // follows it. See coverage-attribution.ts. The map is built from the SHADOW
    // copies, which hold the changed content the changed-line numbers refer to.
    let statements;
    try {
      statements = await buildStatementMap(
        shadow.path,
        pyEdits.map((e) => e.path),
      );
    } catch (err) {
      // The sidecar could not run. Coverage of the change is UNKNOWN; degrading
      // to "covered" here would be a false SAFE bought with no evidence at all.
      // Carry WHY: a silent unknown is indistinguishable from an untested change
      // and cost us a full CI cycle to diagnose once already.
      return unknownCoverage(err instanceof Error ? err.message : String(err));
    }
    // A file we could not parse has no honest containment map, and guessing one
    // means guessing which changed lines are inert. Unknown, never covered.
    if (statements.errors.size > 0) {
      const [file, reason] = [...statements.errors.entries()][0] ?? [];
      return unknownCoverage(`could not map statements in ${file}: ${reason}`);
    }
    const attributed = attributeChangedLines({
      ranges,
      coveredLines: report.coveredLines,
      statementRuns: statements.runs,
      excludedLines: report.excludedLines,
    });
    // A removal-only file has no added lines, so it can never satisfy the
    // per-file heuristic; report it distinctly so the verdict reason can say
    // "nothing to attest" instead of implying a coverage miss. (Its inert-only
    // sibling gets the same treatment and rides along on `attributed`.)
    const removalOnlyFiles = ranges.filter((r) => r.lines.length === 0).map((r) => r.path);
    // Spread, never rebuild field by field: an allow-list silently drops any
    // field a future CoverageAttribution adds, and the last allow-list here also
    // DELETED `uncovered` whenever the verdict was SAFE, which is precisely how
    // the false SAFE stayed invisible. A SAFE report that discloses the changed
    // statements it did not prove is strictly more honest.
    return {
      tool: 'coverage.py',
      ...attributed,
      ...(removalOnlyFiles.length > 0 ? { removalOnlyFiles } : {}),
    };
  } finally {
    await shadow.cleanup();
  }
}
