// tests/unit/temporal.test.ts
import { describe, it, expect } from 'vitest';
import { TemporalAnalyzer } from '../../src/analysis/temporal.js';

describe('TemporalAnalyzer', () => {
  it('computeRiskScore returns DANGER for stale high-blast file', () => {
    const analyzer = new TemporalAnalyzer();
    const score = analyzer.computeRiskScore(80, {
      lastModified: new Date(Date.now() - 400 * 86_400_000),
      changeVelocity: 0.3,
      coChangePairs: [],
      daysSinceLastTouch: 400,
    });
    expect(score).toBe('DANGER');
  });

  it('computeRiskScore returns LOW for trivial blast', () => {
    const analyzer = new TemporalAnalyzer();
    const score = analyzer.computeRiskScore(10, undefined);
    expect(score).toBe('LOW');
  });

  it('computeRiskScore returns HIGH for high blast + stale', () => {
    const analyzer = new TemporalAnalyzer();
    const score = analyzer.computeRiskScore(60, {
      lastModified: new Date(Date.now() - 200 * 86_400_000),
      changeVelocity: 2,
      coChangePairs: [],
      daysSinceLastTouch: 200,
    });
    expect(score).toBe('HIGH');
  });
});
