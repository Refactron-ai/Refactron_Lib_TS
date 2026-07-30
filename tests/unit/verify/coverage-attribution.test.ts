import { describe, it, expect } from 'vitest';
import { attributeChangedLines, UNCOVERED_CAP } from '../../../src/verify/coverage-attribution.js';
import type { ChangedRange } from '../../../src/verify/diff-input.js';

// Shorthand builders. `covered` is the `${relPath}:${line}` key set coverage.py
// produces from executed_lines; `executable` is executed_lines UNION
// missing_lines, i.e. every statement-START line coverage.py knows about.
function cov(...keys: string[]): Set<string> {
  return new Set(keys);
}
function exec(entries: Record<string, number[]>): Map<string, Set<number>> {
  return new Map(Object.entries(entries).map(([k, v]) => [k, new Set(v)]));
}
function ranges(...rs: ChangedRange[]): ChangedRange[] {
  return rs;
}

describe('attributeChangedLines (statement-level coverage attribution)', () => {
  // The pydantic reformat case. `from ipaddress import (` at line 10 is the
  // statement; black split its names across 11..14. coverage.py only ever marks
  // line 10, so a physical-line lookup reports four bogus uncovered entries for
  // an import that provably ran.
  it('continuation lines of an EXECUTED statement count as exercised', () => {
    const out = attributeChangedLines({
      ranges: ranges({ path: 'pkg/mod.py', lines: [10, 11, 12, 13, 14] }),
      coveredLines: cov('pkg/mod.py:10'),
      executableLines: exec({ 'pkg/mod.py': [10, 20] }),
    });
    expect(out.changedLinesCovered).toBe(true);
    expect(out.uncovered).toEqual([]);
  });

  // SAFETY CASE. `x = [1,\n  3]` where ONLY the continuation line changed: the
  // statement start is untouched, so it is NOT in the changed set. Dropping the
  // unattributable line would leave nothing to attest and could fuse to a FALSE
  // SAFE. Enclosing-statement mapping keeps the claim anchored to line 1.
  it('a lone changed CONTINUATION line is attested by its executed statement start', () => {
    const out = attributeChangedLines({
      ranges: ranges({ path: 'pkg/mod.py', lines: [2] }),
      coveredLines: cov('pkg/mod.py:1'),
      executableLines: exec({ 'pkg/mod.py': [1] }),
    });
    expect(out.changedLinesCovered).toBe(true);
    expect(out.uncovered).toEqual([]);
  });

  it('a lone changed CONTINUATION line of an UNEXECUTED statement is one entry at the start', () => {
    const out = attributeChangedLines({
      ranges: ranges({ path: 'pkg/mod.py', lines: [2] }),
      coveredLines: cov(), // line 1 never ran
      executableLines: exec({ 'pkg/mod.py': [1] }),
    });
    expect(out.changedLinesCovered).toBe(false);
    expect(out.uncovered).toEqual([{ file: 'pkg/mod.py', line: 1 }]);
  });

  it('dedupes: one unexecuted 10-line statement yields exactly ONE uncovered entry', () => {
    const out = attributeChangedLines({
      ranges: ranges({ path: 'pkg/mod.py', lines: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14] }),
      coveredLines: cov('pkg/mod.py:20'),
      executableLines: exec({ 'pkg/mod.py': [5, 20] }),
    });
    expect(out.uncovered).toEqual([{ file: 'pkg/mod.py', line: 5 }]);
  });

  it('does NOT weaken: a genuinely untested statement is still reported uncovered', () => {
    const out = attributeChangedLines({
      ranges: ranges({ path: 'pkg/mod.py', lines: [30] }),
      coveredLines: cov('pkg/mod.py:10'),
      executableLines: exec({ 'pkg/mod.py': [10, 30] }),
    });
    expect(out.changedLinesCovered).toBe(false);
    expect(out.uncovered).toEqual([{ file: 'pkg/mod.py', line: 30 }]);
  });

  it('mixes: one executed statement in a file is enough for the per-file heuristic', () => {
    const out = attributeChangedLines({
      ranges: ranges({ path: 'pkg/mod.py', lines: [10, 11, 30] }),
      coveredLines: cov('pkg/mod.py:10'),
      executableLines: exec({ 'pkg/mod.py': [10, 30] }),
    });
    // Documented v1 limitation preserved: partial per-file coverage reads as
    // covered, so the uncovered list is suppressed downstream, not here.
    expect(out.changedLinesCovered).toBe(true);
    expect(out.uncovered).toEqual([{ file: 'pkg/mod.py', line: 30 }]);
  });

  it('every changed file must have an exercised statement (per-file, not global)', () => {
    const out = attributeChangedLines({
      ranges: ranges({ path: 'a.py', lines: [10, 11] }, { path: 'b.py', lines: [5] }),
      coveredLines: cov('a.py:10'),
      executableLines: exec({ 'a.py': [10], 'b.py': [5] }),
    });
    expect(out.changedLinesCovered).toBe(false);
    expect(out.uncovered).toEqual([{ file: 'b.py', line: 5 }]);
  });

  // A changed line ABOVE the first statement (leading comments, module docstring
  // area) has no enclosing statement. It must never be dropped: dropping is the
  // false-SAFE path. It is reported at its own physical line and does not count
  // as exercised.
  it('a changed line with no statement at or above it is unattributable, never exercised', () => {
    const out = attributeChangedLines({
      ranges: ranges({ path: 'pkg/mod.py', lines: [1, 2] }),
      coveredLines: cov('pkg/mod.py:10'),
      executableLines: exec({ 'pkg/mod.py': [10] }),
    });
    expect(out.changedLinesCovered).toBe(false);
    expect(out.uncovered).toEqual([
      { file: 'pkg/mod.py', line: 1 },
      { file: 'pkg/mod.py', line: 2 },
    ]);
  });

  it('a measured file with an EMPTY executable set never reads as covered', () => {
    const out = attributeChangedLines({
      ranges: ranges({ path: 'pkg/mod.py', lines: [3, 4] }),
      coveredLines: cov(),
      executableLines: exec({ 'pkg/mod.py': [] }),
    });
    expect(out.changedLinesCovered).toBe(false);
    expect(out.uncovered).toEqual([
      { file: 'pkg/mod.py', line: 3 },
      { file: 'pkg/mod.py', line: 4 },
    ]);
  });

  it('a file absent from executableLines never reads as covered', () => {
    const out = attributeChangedLines({
      ranges: ranges({ path: 'pkg/mod.py', lines: [3] }),
      coveredLines: cov(),
      executableLines: exec({}),
    });
    expect(out.changedLinesCovered).toBe(false);
    expect(out.uncovered).toEqual([{ file: 'pkg/mod.py', line: 3 }]);
  });

  // Removal-only: no added lines at all. Must stay exactly as before: not
  // covered (there is nothing to attest) and contributing NO uncovered entries,
  // so verdict-fuse can still recognise the removal-only shape.
  it('a removal-only range contributes no uncovered entries and cannot be covered', () => {
    const out = attributeChangedLines({
      ranges: ranges({ path: 'pkg/mod.py', lines: [] }),
      coveredLines: cov('pkg/mod.py:1'),
      executableLines: exec({ 'pkg/mod.py': [1] }),
    });
    expect(out.changedLinesCovered).toBe(false);
    expect(out.uncovered).toEqual([]);
  });

  it('mixed removal-only + uncovered keeps both signals', () => {
    const out = attributeChangedLines({
      ranges: ranges({ path: 'a.py', lines: [] }, { path: 'b.py', lines: [3] }),
      coveredLines: cov(),
      executableLines: exec({ 'a.py': [1], 'b.py': [3] }),
    });
    expect(out.changedLinesCovered).toBe(false);
    expect(out.uncovered).toEqual([{ file: 'b.py', line: 3 }]);
  });

  it('normalizes `./` paths so lookups hit, and reports the caller path verbatim', () => {
    const out = attributeChangedLines({
      ranges: ranges({ path: './pkg/mod.py', lines: [11] }),
      coveredLines: cov('pkg/mod.py:10'),
      executableLines: exec({ 'pkg/mod.py': [10] }),
    });
    expect(out.changedLinesCovered).toBe(true);
    expect(out.uncovered).toEqual([]);
  });

  describe('uncovered cap', () => {
    it('truncates with an explicit signal rather than silently dropping', () => {
      const lines = Array.from({ length: UNCOVERED_CAP + 25 }, (_, i) => (i + 1) * 2);
      const out = attributeChangedLines({
        ranges: ranges({ path: 'a.py', lines }),
        coveredLines: cov(),
        executableLines: exec({ 'a.py': lines }),
      });
      expect(out.uncovered).toHaveLength(UNCOVERED_CAP);
      expect(out.uncoveredTruncated).toEqual({
        shown: UNCOVERED_CAP,
        total: UNCOVERED_CAP + 25,
      });
    });

    it('leaves the signal absent when nothing was dropped', () => {
      const out = attributeChangedLines({
        ranges: ranges({ path: 'a.py', lines: [1] }),
        coveredLines: cov(),
        executableLines: exec({ 'a.py': [1] }),
      });
      expect(out.uncoveredTruncated).toBeUndefined();
    });

    it('honours an explicit cap override', () => {
      const out = attributeChangedLines({
        ranges: ranges({ path: 'a.py', lines: [1, 3, 5] }),
        coveredLines: cov(),
        executableLines: exec({ 'a.py': [1, 3, 5] }),
        uncoveredCap: 2,
      });
      expect(out.uncovered).toEqual([
        { file: 'a.py', line: 1 },
        { file: 'a.py', line: 3 },
      ]);
      expect(out.uncoveredTruncated).toEqual({ shown: 2, total: 3 });
    });
  });
});
