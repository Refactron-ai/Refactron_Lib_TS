// src/verify/verify-diff.ts
// Verify an arbitrary diff Refactron did NOT author. Composes the existing
// RefactronVerifier (pass/fail gates) with reportCoverage (changed-line
// coverage, Python only) into a SAFE/UNSAFE/UNPROVEN verdict. Read-only:
// never mutates the caller's repo.
import * as path from 'node:path';
import { RefactronVerifier } from './engine.js';
import { createShadowTree } from './shadow-tree.js';
import { reportCoverage, normalizePath } from '../analyze/coverage/index.js';
import { fuseVerdict, type CoverageAssessment, type VerdictReport } from './verdict-fuse.js';
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

// The two consumers of `testCmd` disagree on shape. RefactronVerifier runs it as
// a full shell command (`sh -c "<testCmd>"`), so it wants `python3 -m pytest -q`.
// reportCoverage runs `python -m coverage run -m <testCmd tokens>`, so it wants
// the module invocation *after* `python -m` (`pytest -q`). Strip a leading
// `python[3] -m ` so the caller can pass one full command and both get the form
// they expect.
function toCoverageModuleCmd(testCmd: string): string {
  return testCmd.replace(/^\s*python[0-9.]*\s+-m\s+/, '');
}

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
  let cov: CoverageAssessment = { tool: 'none', changedLinesCovered: 'unknown', uncovered: [] };
  if (result.passed) {
    cov = await assessCoverage(input, edits);
  }

  // 3. Fuse.
  return fuseVerdict(result, changedFiles, cov);
}

async function assessCoverage(
  input: VerifyDiffInput,
  edits: FileEdit[],
): Promise<CoverageAssessment> {
  const pyEdits = edits.filter((e) => e.path.endsWith('.py'));
  if (pyEdits.length === 0) {
    return { tool: 'none', changedLinesCovered: 'unknown', uncovered: [] };
  }
  const shadow = await createShadowTree(input.repoRoot, toChanges(input.repoRoot, edits));
  try {
    const covTestCmd = input.testCmd ? toCoverageModuleCmd(input.testCmd) : undefined;
    const report = await reportCoverage({
      projectRoot: shadow.path,
      ...(covTestCmd ? { testCmd: covTestCmd } : {}),
    });
    if (!report.coverageToolFound) {
      return { tool: 'none', changedLinesCovered: 'unknown', uncovered: [] };
    }
    const ranges = await changedLinesForEdits(input.repoRoot, pyEdits);
    const uncovered: Array<{ file: string; line: number }> = [];
    for (const r of ranges) {
      const rel = normalizePath(r.path);
      for (const line of r.lines) {
        if (!report.coveredLines.has(`${rel}:${line}`)) uncovered.push({ file: r.path, line });
      }
    }
    // v1 heuristic: the change is "covered" iff every changed Python file has at
    // least one changed line that was executed by the test suite (the change is
    // on a tested path). Documented limitation: partial per-line coverage still
    // reads as covered; line-level strictness is a fast-follow. Honesty is
    // preserved on the other side — zero executed changed lines → UNPROVEN.
    const changedLinesCovered = ranges.every((r) => {
      const rel = normalizePath(r.path);
      return r.lines.some((line) => report.coveredLines.has(`${rel}:${line}`));
    });
    return {
      tool: 'coverage.py',
      changedLinesCovered,
      uncovered: changedLinesCovered ? [] : uncovered,
    };
  } finally {
    await shadow.cleanup();
  }
}
