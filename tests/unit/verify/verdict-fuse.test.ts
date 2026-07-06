import { describe, it, expect } from 'vitest';
import { fuseVerdict, type CoverageAssessment } from '../../../src/verify/verdict-fuse.js';
import type { VerificationResult } from '../../../src/contracts.js';

const ok = { passed: true, durationMs: 1 };
function result(passed: boolean, testsReason?: string): VerificationResult {
  return {
    passed,
    gates: {
      syntax: ok,
      imports: ok,
      tests: passed
        ? ok
        : { passed: false, durationMs: 1, blockingReason: testsReason ?? 'tests failed' },
    },
    writableChanges: [],
  };
}
const covered: CoverageAssessment = {
  tool: 'coverage.py',
  changedLinesCovered: true,
  uncovered: [],
};
const uncovered: CoverageAssessment = {
  tool: 'coverage.py',
  changedLinesCovered: false,
  uncovered: [{ file: 'a.py', line: 5 }],
};
const unknown: CoverageAssessment = { tool: 'none', changedLinesCovered: 'unknown', uncovered: [] };

describe('fuseVerdict', () => {
  it('a failing gate → UNSAFE, surfacing the blocking reason', () => {
    const r = fuseVerdict(result(false, 'test_x broke'), ['a.py'], unknown);
    expect(r.verdict).toBe('UNSAFE');
    expect(r.reason).toContain('test_x broke');
  });
  it('tests pass + changed lines covered → SAFE', () => {
    expect(fuseVerdict(result(true), ['a.py'], covered).verdict).toBe('SAFE');
  });
  it('tests pass + changed lines uncovered → UNPROVEN with missingTests', () => {
    const r = fuseVerdict(result(true), ['a.py'], uncovered);
    expect(r.verdict).toBe('UNPROVEN');
    expect(r.missingTests?.[0]?.file).toBe('a.py');
  });
  it('tests pass + coverage unknown → UNPROVEN, never SAFE (fail-safe)', () => {
    expect(fuseVerdict(result(true), ['a.ts'], unknown).verdict).toBe('UNPROVEN');
  });
});
