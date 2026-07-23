import { describe, it, expect } from 'vitest';
import { summarizeVitestFailures } from '../../../src/verify/summarize-vitest.js';

describe('summarizeVitestFailures', () => {
  it('extracts one FAIL with file + test name + message', () => {
    const stdout = [
      ' FAIL  tests/unit/foo.test.ts > my failing test',
      'AssertionError: expected 1 to equal 2',
      '    at line 5',
      '',
      ' Test Files  1 failed (1)',
    ].join('\n');
    const r = summarizeVitestFailures(stdout);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]?.file).toBe('tests/unit/foo.test.ts');
    expect(r.failures[0]?.testName).toBe('my failing test');
    expect(r.failures[0]?.message).toContain('AssertionError');
    expect(r.suiteSummary).toMatch(/Test Files\s+1 failed/);
  });

  it('handles multiple FAIL records', () => {
    const stdout = [
      ' FAIL  tests/unit/a.test.ts > test a',
      'Error A',
      ' FAIL  tests/unit/b.test.ts > test b',
      'Error B',
      ' Test Files  2 failed (2)',
    ].join('\n');
    const r = summarizeVitestFailures(stdout);
    expect(r.failures).toHaveLength(2);
    expect(r.failures[0]?.testName).toBe('test a');
    expect(r.failures[1]?.testName).toBe('test b');
    expect(r.failures[0]?.message).toContain('Error A');
    expect(r.failures[1]?.message).toContain('Error B');
  });

  it('returns empty failures + null suiteSummary when no FAIL lines', () => {
    const stdout = 'all good\nnothing to see';
    const r = summarizeVitestFailures(stdout);
    expect(r.failures).toHaveLength(0);
    expect(r.suiteSummary).toBeNull();
  });

  it('matches spec-style and .mts/.cts/.mjs/.cjs FAIL lines, not just .test.[tj]sx', () => {
    // The flaky delta keys off parsed failure ids; a repo using .spec.mts (or the
    // other module-extension variants verdict-fuse.isTestFile recognizes) must not
    // silently yield an empty failure set and no-op the whole flaky feature.
    const stdout = [
      ' FAIL  tests/unit/foo.spec.mts > my failing spec',
      'AssertionError: expected 1 to equal 2',
      ' FAIL  tests/unit/bar.test.cjs > another one',
      'Error: boom',
      ' Test Files  2 failed (2)',
    ].join('\n');
    const r = summarizeVitestFailures(stdout);
    expect(r.failures).toHaveLength(2);
    expect(r.failures[0]?.file).toBe('tests/unit/foo.spec.mts');
    expect(r.failures[0]?.testName).toBe('my failing spec');
    expect(r.failures[1]?.file).toBe('tests/unit/bar.test.cjs');
  });

  it('caps message at 10 lines per failure', () => {
    const lines = [' FAIL  tests/unit/x.test.ts > big'];
    for (let i = 0; i < 25; i++) lines.push(`context-line-${i}`);
    const r = summarizeVitestFailures(lines.join('\n'));
    expect(r.failures).toHaveLength(1);
    const msgLines = (r.failures[0]?.message ?? '').split('\n');
    expect(msgLines.length).toBeLessThanOrEqual(10);
  });
});
