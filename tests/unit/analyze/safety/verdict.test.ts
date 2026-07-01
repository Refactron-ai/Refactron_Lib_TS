import { describe, it, expect } from 'vitest';
import { assessFinding, buildSafetyReport } from '../../../../src/analyze/safety/verdict.js';
import type { DetectorFinding } from '../../../../src/analyze/detectors/types.js';

function finding(opts: {
  shape: 'safe' | 'flag';
  flagReason?: string;
  testCovered?: 'yes' | 'no' | 'unknown';
  line?: number;
}): DetectorFinding {
  const meta = opts.flagReason
    ? { shape: opts.shape, flagReason: opts.flagReason }
    : { shape: opts.shape };
  return {
    id: `id-${opts.line ?? 1}`,
    file: 'svc.py',
    line: opts.line ?? 1,
    transformId: 'sqlalchemy_query_to_select' as never,
    remediationMinutes: 25,
    confidence: 'medium',
    testCovered: opts.testCovered ?? 'unknown',
    meta,
  } as unknown as DetectorFinding;
}

describe('assessFinding', () => {
  it('safe shape + covered -> safe-to-automate', () => {
    expect(assessFinding(finding({ shape: 'safe', testCovered: 'yes' })).verdict).toBe(
      'safe-to-automate',
    );
  });
  it('safe verdict carries no flagReason (null)', () => {
    expect(assessFinding(finding({ shape: 'safe', testCovered: 'yes' })).flagReason).toBeNull();
  });
  it('safe shape + uncovered -> unproven', () => {
    expect(assessFinding(finding({ shape: 'safe', testCovered: 'no' })).verdict).toBe('unproven');
  });
  it('safe shape + unknown coverage -> unproven', () => {
    expect(assessFinding(finding({ shape: 'safe', testCovered: 'unknown' })).verdict).toBe(
      'unproven',
    );
  });
  it('flag shape -> needs-review regardless of coverage, preserving flagReason', () => {
    const a = assessFinding(
      finding({ shape: 'flag', flagReason: 'bulk-delete-semantics', testCovered: 'yes' }),
    );
    expect(a.verdict).toBe('needs-review');
    expect(a.flagReason).toBe('bulk-delete-semantics');
  });
  it('missing meta -> needs-review with unclassified flagReason (fail safe)', () => {
    const malformed = {
      id: 'id-nometa',
      file: 'svc.py',
      line: 1,
      transformId: 'sqlalchemy_query_to_select',
      remediationMinutes: 25,
      confidence: 'medium',
      testCovered: 'yes',
    } as unknown as DetectorFinding;
    const a = assessFinding(malformed);
    expect(a.verdict).toBe('needs-review');
    expect(a.flagReason).toBe('unclassified');
  });
});

describe('buildSafetyReport', () => {
  it('counts verdicts and reports coverage availability', () => {
    const report = buildSafetyReport('app/', 'sqlalchemy_query_to_select', [
      finding({ shape: 'safe', testCovered: 'yes', line: 1 }),
      finding({ shape: 'safe', testCovered: 'no', line: 2 }),
      finding({ shape: 'flag', flagReason: 'multi-column-select', testCovered: 'no', line: 3 }),
    ]);
    expect(report.total).toBe(3);
    expect(report.counts).toEqual({ 'safe-to-automate': 1, unproven: 1, 'needs-review': 1 });
    expect(report.coverageAvailable).toBe(true);
  });
  it('marks coverage unavailable when every site is unknown', () => {
    const report = buildSafetyReport('app/', 'sqlalchemy_query_to_select', [
      finding({ shape: 'safe', testCovered: 'unknown' }),
    ]);
    expect(report.coverageAvailable).toBe(false);
  });
  it('reports total site count in the all-unknown case', () => {
    const report = buildSafetyReport('app/', 'sqlalchemy_query_to_select', [
      finding({ shape: 'safe', testCovered: 'unknown' }),
    ]);
    expect(report.total).toBe(1);
  });
});
