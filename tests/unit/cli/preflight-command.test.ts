import { describe, it, expect } from 'vitest';
import { parsePreflightFlags, PreflightFlagError } from '../../../src/cli/preflight-command.js';

describe('parsePreflightFlags', () => {
  it('defaults target to "." with no flags', () => {
    expect(parsePreflightFlags([])).toEqual({ target: '.', json: false, failOnUnproven: false });
  });
  it('parses a target plus --json and --fail-on-unproven', () => {
    expect(parsePreflightFlags(['src/', '--json', '--fail-on-unproven'])).toEqual({
      target: 'src/',
      json: true,
      failOnUnproven: true,
    });
  });
  it('throws PreflightFlagError on an unknown flag', () => {
    expect(() => parsePreflightFlags(['--nope'])).toThrow(PreflightFlagError);
  });
  it('throws PreflightFlagError on a second positional argument', () => {
    expect(() => parsePreflightFlags(['a', 'b'])).toThrow(PreflightFlagError);
  });
});
