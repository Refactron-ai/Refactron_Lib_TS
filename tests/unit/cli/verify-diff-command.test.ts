import { describe, it, expect } from 'vitest';
import { parseVerifyDiffFlags, VerifyDiffFlagError } from '../../../src/cli/verify-diff-command.js';

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
