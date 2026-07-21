import { describe, it, expect } from 'vitest';
import { formatSafetyReport, safetyReportToJson } from '../../../src/cli/format-safety.js';
import type { SafetyReport } from '../../../src/analyze/safety/verdict.js';

const baseReport: SafetyReport = {
  root: 'app/',
  transformId: 'sqlalchemy_query_to_select',
  total: 3,
  counts: { 'safe-to-automate': 1, unproven: 1, 'needs-review': 1 },
  coverageAvailable: true,
  sites: [
    {
      id: 'a',
      file: 'svc.py',
      line: 5,
      flagReason: null,
      testCovered: 'yes',
      verdict: 'safe-to-automate',
    },
    { id: 'b', file: 'svc.py', line: 9, flagReason: null, testCovered: 'no', verdict: 'unproven' },
    {
      id: 'c',
      file: 'svc.py',
      line: 13,
      flagReason: 'bulk-delete-semantics',
      testCovered: 'yes',
      verdict: 'needs-review',
    },
  ],
};

describe('formatSafetyReport', () => {
  it('renders a tag per verdict and a summary line', () => {
    const text = formatSafetyReport(baseReport)
      .map((l) => l.text)
      .join('\n');
    expect(text).toContain('[SAFE] svc.py:5');
    expect(text).toContain('[UNPROVEN] svc.py:9');
    expect(text).toContain('[REVIEW] svc.py:13 (bulk-delete-semantics)');
    expect(text).toContain('1 safe-to-automate · 1 unproven · 1 needs-review');
  });
  it('warns when coverage is unavailable', () => {
    const text = formatSafetyReport({ ...baseReport, coverageAvailable: false })
      .map((l) => l.text)
      .join('\n');
    expect(text).toContain('coverage.py not available');
  });
  it('does not warn about coverage on a zero-site report', () => {
    const emptyReport: SafetyReport = {
      root: 'app/',
      transformId: 'sqlalchemy_query_to_select',
      total: 0,
      counts: { 'safe-to-automate': 0, unproven: 0, 'needs-review': 0 },
      coverageAvailable: false,
      sites: [],
    };
    const text = formatSafetyReport(emptyReport)
      .map((l) => l.text)
      .join('\n');
    expect(text).not.toContain('coverage.py not available');
  });
});

describe('safetyReportToJson', () => {
  it('round-trips the report', () => {
    expect(JSON.parse(safetyReportToJson(baseReport))).toEqual(baseReport);
  });
});
