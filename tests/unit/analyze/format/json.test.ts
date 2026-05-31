import { describe, it, expect } from 'vitest';
import { toJson } from '../../../../src/analyze/format/json.js';
import {
  TIER_BY_TRANSFORM,
  type TransformTier,
} from '../../../../src/cli/v2-adapters.js';
import type { TransformId } from '../../../../src/contracts.js';

type ParsedSummary = {
  totalFindings: number;
  totalMinutes: number;
  byTransform: Record<string, number>;
  byTier: Record<TransformTier, number>;
  minutesByTier: Record<TransformTier, number>;
};

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
      summary: ParsedSummary;
      importGraph: Record<string, string[]>;
    };
    expect(parsed.findings.length).toBe(1);
    expect(parsed.summary.totalMinutes).toBe(2);
    expect(parsed.importGraph['a.py']).toEqual(['b.py']);
  });

  it('emits byTier and minutesByTier; tier minutes sum to totalMinutes', () => {
    const out = toJson({
      root: '/x',
      analyzedAt: new Date('2026-01-01'),
      findings: [
        // 1 debt finding (super_no_args), 5 min
        { id: 'a', file: 'a.py', line: 1, transformId: 'super_no_args', remediationMinutes: 5, confidence: 'high' },
        // 2 style findings (format_to_fstring), 2 min each
        { id: 'b', file: 'b.py', line: 1, transformId: 'format_to_fstring', remediationMinutes: 2, confidence: 'high' },
        { id: 'c', file: 'b.py', line: 2, transformId: 'format_to_fstring', remediationMinutes: 2, confidence: 'high' },
        // 1 modernization finding (class_to_dataclass), 10 min
        { id: 'd', file: 'c.py', line: 1, transformId: 'class_to_dataclass', remediationMinutes: 10, confidence: 'high' },
      ],
      importGraph: new Map(),
      callEdges: [],
    });
    const parsed = JSON.parse(out) as { summary: ParsedSummary };
    expect(parsed.summary.byTier).toEqual({ debt: 1, modernization: 1, style: 2 });
    expect(parsed.summary.minutesByTier).toEqual({ debt: 5, modernization: 10, style: 4 });
    expect(
      parsed.summary.minutesByTier.debt +
        parsed.summary.minutesByTier.modernization +
        parsed.summary.minutesByTier.style,
    ).toBe(parsed.summary.totalMinutes);
  });

  // Golden assignment: pins each TransformId's tier so a future re-tier (or a
  // catalog rename) shows up in CI as a deliberate test edit, not silent drift.
  it('TIER_BY_TRANSFORM covers all 20 transforms with the expected distribution (6/10/4)', () => {
    const entries = Object.entries(TIER_BY_TRANSFORM) as Array<[TransformId, TransformTier]>;
    expect(entries).toHaveLength(20);
    const counts: Record<TransformTier, number> = { debt: 0, modernization: 0, style: 0 };
    for (const [, tier] of entries) counts[tier]++;
    expect(counts).toEqual({ debt: 6, modernization: 10, style: 4 });
  });
});
