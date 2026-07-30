import { describe, it, expect } from 'vitest';
import {
  parseVerifyDiffFlags,
  VerifyDiffFlagError,
  formatTestFilesNote,
  formatFlakyNote,
  formatUncoveredLines,
} from '../../../src/cli/verify-diff-command.js';

describe('formatUncoveredLines', () => {
  it('prints one line per uncovered statement', () => {
    expect(
      formatUncoveredLines({
        tool: 'coverage.py',
        changedLinesCovered: false,
        uncovered: [
          { file: 'a.py', line: 16 },
          { file: 'b.py', line: 4 },
        ],
      }),
    ).toEqual(['  uncovered: a.py:16', '  uncovered: b.py:4']);
  });

  it('discloses truncation instead of shipping a short list that looks complete', () => {
    const lines = formatUncoveredLines({
      tool: 'coverage.py',
      changedLinesCovered: false,
      uncovered: [{ file: 'a.py', line: 1 }],
      uncoveredTruncated: { shown: 1, total: 412 },
    });
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('  ... and 411 more uncovered statement(s) (412 total)');
  });

  it('emits nothing when the change is fully covered', () => {
    expect(
      formatUncoveredLines({ tool: 'coverage.py', changedLinesCovered: true, uncovered: [] }),
    ).toEqual([]);
  });
});

describe('parseVerifyDiffFlags', () => {
  it('defaults repoRoot to "." with no flags', () => {
    expect(parseVerifyDiffFlags([])).toEqual({
      repoRoot: '.',
      diffPath: null,
      json: false,
      testCmd: null,
    });
  });
  it('parses repoRoot + --diff + --json + --test-cmd', () => {
    expect(
      parseVerifyDiffFlags(['proj/', '--diff', 'c.patch', '--json', '--test-cmd', 'pytest -q']),
    ).toEqual({
      repoRoot: 'proj/',
      diffPath: 'c.patch',
      json: true,
      testCmd: 'pytest -q',
    });
  });
  it('parses --diff= and --test-cmd= equals form', () => {
    expect(parseVerifyDiffFlags(['proj/', '--diff=c.patch', '--test-cmd=pytest -q'])).toEqual({
      repoRoot: 'proj/',
      diffPath: 'c.patch',
      json: false,
      testCmd: 'pytest -q',
    });
  });
  it('throws on unknown flag', () => {
    expect(() => parseVerifyDiffFlags(['--nope'])).toThrow(VerifyDiffFlagError);
  });
  it('throws on a second positional', () => {
    expect(() => parseVerifyDiffFlags(['a', 'b'])).toThrow(VerifyDiffFlagError);
  });
});

describe('formatTestFilesNote', () => {
  it('returns null when no test files changed', () => {
    expect(formatTestFilesNote([])).toBeNull();
  });
  it('names the count and the changed test files', () => {
    expect(formatTestFilesNote(['tests/test_make.py', 'foo.spec.ts'])).toBe(
      'note: this diff modifies test files (2): tests/test_make.py, foo.spec.ts',
    );
  });
  it('previews the first few and elides the rest', () => {
    expect(formatTestFilesNote(['a_test.py', 'b_test.py', 'c_test.py', 'd_test.py'])).toBe(
      'note: this diff modifies test files (4): a_test.py, b_test.py, c_test.py, ...',
    );
  });
});

describe('formatFlakyNote', () => {
  it('returns null when no tests flipped on retry', () => {
    expect(formatFlakyNote([])).toBeNull();
  });
  it('names the count and the flaky test ids', () => {
    expect(formatFlakyNote(['test_a.py::test_x', 'test_b.py::test_y'])).toBe(
      'note: 2 test(s) flipped on retry and were treated as flaky: test_a.py::test_x, test_b.py::test_y',
    );
  });
  it('previews the first few and elides the rest', () => {
    expect(formatFlakyNote(['t1::a', 't2::b', 't3::c', 't4::d'])).toBe(
      'note: 4 test(s) flipped on retry and were treated as flaky: t1::a, t2::b, t3::c, ...',
    );
  });
});
