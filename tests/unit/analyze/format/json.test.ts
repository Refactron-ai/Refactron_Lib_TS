import { describe, it, expect } from 'vitest';
import { toJson } from '../../../../src/analyze/format/json.js';

describe('toJson', () => {
  it('serializes report deterministically', () => {
    const out = toJson({
      root: '/x',
      analyzedAt: new Date('2026-01-01'),
      findings: [
        {
          id: '1',
          file: 'a.py',
          line: 1,
          transformId: 'format_to_fstring',
          remediationMinutes: 2,
          confidence: 'high',
        },
      ],
      importGraph: new Map([['a.py', new Set(['b.py'])]]),
      callEdges: [{ caller: 'f', callee: 'g', file: 'a.py' }],
    });
    const parsed = JSON.parse(out) as {
      findings: unknown[];
      summary: { totalMinutes: number };
      importGraph: Record<string, string[]>;
    };
    expect(parsed.findings.length).toBe(1);
    expect(parsed.summary.totalMinutes).toBe(2);
    expect(parsed.importGraph['a.py']).toEqual(['b.py']);
  });
});
