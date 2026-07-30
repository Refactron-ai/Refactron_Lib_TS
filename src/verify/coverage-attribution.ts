// src/verify/coverage-attribution.ts
// Map changed physical lines to the STATEMENTS coverage.py actually tracks, then
// judge coverage on those statements. Pure: no I/O, no process state.
//
// Why this exists. coverage.py records execution against a statement's FIRST
// line only. Continuation lines, closing brackets, comments and blanks appear in
// neither `executed_lines` nor `missing_lines`, so asking "is this exact
// physical line in the executed set?" answers "no" for every line a formatter
// wrapped. A 396-hunk `black` reformat of pydantic/_internal produced 3666 such
// entries, among them lines 24-30 of _generate_schema.py: the names inside a
// `from ipaddress import (...)` whose statement start (line 23) provably ran.
// The verdict direction was conservative, but the evidence was fiction.
//
// The fix is attribution, NOT exclusion. Silently dropping changed lines that
// are not statement starts would be the false-SAFE path: `x = [1,\n  3]` with
// only the continuation edited has an unchanged statement start, so dropping the
// one changed line leaves nothing to attest and a diff that DID change behavior
// could fuse to SAFE. Mapping to the enclosing statement keeps the claim
// anchored: the statement start is executable, and if it ran, the changed text
// ran with it.
import { normalizePath } from '../analyze/coverage/index.js';
import type { ChangedRange } from './diff-input.js';

/** Ceiling on reported uncovered statements. Even after dedup a mass reformat
 *  can produce thousands; an 883 KB JSON report helps nobody. Truncation is
 *  always reported in `uncoveredTruncated`, because a silently short list
 *  would be a lie about the size of the gap. */
export const UNCOVERED_CAP = 200;

export interface CoverageAttributionInput {
  ranges: ChangedRange[];
  /** `${normalizedRelPath}:${line}` for every line coverage.py saw execute. */
  coveredLines: Set<string>;
  /** Statement-start lines per normalized relative path (executed UNION missing). */
  executableLines: Map<string, Set<number>>;
  /** Test seam; defaults to UNCOVERED_CAP. */
  uncoveredCap?: number;
}

export interface CoverageAttribution {
  changedLinesCovered: boolean;
  /** One entry per UNEXECUTED enclosing statement, deduped, capped. */
  uncovered: Array<{ file: string; line: number }>;
  uncoveredTruncated?: { shown: number; total: number };
}

/** `max{ e in stmts : e <= line }`, or null when `line` sits above every
 *  statement in the file. `stmts` must be ascending. Binary search, not a scan:
 *  a mass reformat pairs thousands of changed lines with thousands of
 *  statements, and the quadratic version of this is a visible stall. */
function enclosingStatement(stmts: number[], line: number): number | null {
  let lo = 0;
  let hi = stmts.length - 1;
  let best: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = stmts[mid] as number;
    if (v <= line) {
      best = v;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

export function attributeChangedLines(input: CoverageAttributionInput): CoverageAttribution {
  const cap = input.uncoveredCap ?? UNCOVERED_CAP;
  const uncovered: Array<{ file: string; line: number }> = [];
  let total = 0;
  let allFilesExercised = true;

  for (const r of input.ranges) {
    const rel = normalizePath(r.path);
    const stmts = [...(input.executableLines.get(rel) ?? [])].sort((a, b) => a - b);
    // Per-file dedup: one unexecuted multi-line statement reports ONCE, however
    // many of its physical lines the diff touched. Statement starts and
    // unattributable lines can never collide here: an unattributable line is by
    // definition below every statement start in the file.
    const seen = new Set<number>();
    let fileExercised = false;

    const record = (line: number): void => {
      if (seen.has(line)) return;
      seen.add(line);
      total += 1;
      if (uncovered.length < cap) uncovered.push({ file: r.path, line });
    };

    for (const line of r.lines) {
      const stmt = enclosingStatement(stmts, line);
      if (stmt === null) {
        // Nothing to attribute to: the line is above the file's first statement
        // (leading comments, the module-docstring area) or the file has no
        // statements at all. "Cannot attribute" must never read as "fine", since
        // dropping it here is the false-SAFE path, so it is reported at its own
        // physical line and counts against the file.
        record(line);
        continue;
      }
      if (input.coveredLines.has(`${rel}:${stmt}`)) {
        fileExercised = true;
        continue;
      }
      record(stmt);
    }
    // A removal-only range (no added lines) can never satisfy this, exactly as
    // before; verify-diff reports those files separately so the verdict reason
    // can say "nothing to attest" instead of implying a coverage miss.
    if (!fileExercised) allFilesExercised = false;
  }

  return {
    // v1 heuristic, unchanged: the change is covered iff EVERY changed file has
    // at least one changed statement that executed. Documented limitation:
    // partial per-file coverage still reads as covered.
    changedLinesCovered: allFilesExercised,
    uncovered,
    ...(total > uncovered.length ? { uncoveredTruncated: { shown: uncovered.length, total } } : {}),
  };
}
