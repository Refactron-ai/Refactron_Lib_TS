import { describe, it, expect } from 'vitest';
import { estimateTokens, truncateToBudget } from '../../../src/document/budget.js';

describe('estimateTokens', () => {
  it('uses the 4-chars-per-token heuristic', () => {
    expect(estimateTokens('abcd'.repeat(100))).toBe(100);
  });

  it('rounds up partial tokens', () => {
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('truncateToBudget', () => {
  it('returns the input unchanged when within budget', () => {
    expect(truncateToBudget('short text', 1000)).toBe('short text');
  });

  it('truncates the middle of a long input, keeping prefix and suffix', () => {
    const input = 'aaaa\n'.repeat(2000);
    const out = truncateToBudget(input, 100);
    expect(out.length).toBeLessThan(input.length);
    expect(out.startsWith('aaaa')).toBe(true);
    expect(out).toContain('elided');
    expect(out.trimEnd().endsWith('aaaa')).toBe(true);
  });

  it('reports the number of elided newlines in the marker', () => {
    const input = 'aaaa\n'.repeat(2000);
    const out = truncateToBudget(input, 100);
    expect(out).toMatch(/\[\.\.\. \d+ lines elided \.\.\.\]/);
  });
});
