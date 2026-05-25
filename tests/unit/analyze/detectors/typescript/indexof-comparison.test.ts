import { describe, it, expect } from 'vitest';
import { parseTypescript } from '../../../../../src/analyze/parser.js';
import { detect } from '../../../../../src/analyze/detectors/typescript/indexof-comparison.js';

const ctx = (s: string) => ({
  absPath: '/x/a.ts',
  relPath: 'a.ts',
  source: s,
  tree: parseTypescript(s, false),
});

describe('ts: indexof-comparison', () => {
  it('flags arr.indexOf(x) !== -1', () => {
    expect(detect(ctx('arr.indexOf(2) !== -1\n'))).toHaveLength(1);
  });
  it('flags arr.indexOf(x) >= 0', () => {
    expect(detect(ctx('arr.indexOf(2) >= 0\n'))).toHaveLength(1);
  });
  it('flags arr.indexOf(x) > -1', () => {
    expect(detect(ctx('arr.indexOf(2) > -1\n'))).toHaveLength(1);
  });
  it('flags arr.indexOf(x) === -1 (negative)', () => {
    expect(detect(ctx('arr.indexOf(2) === -1\n'))).toHaveLength(1);
  });
  it('flags arr.indexOf(x) < 0 (negative)', () => {
    expect(detect(ctx('arr.indexOf(2) < 0\n'))).toHaveLength(1);
  });
  it('flags mirrored -1 !== arr.indexOf(x)', () => {
    expect(detect(ctx('-1 !== arr.indexOf(2)\n'))).toHaveLength(1);
  });
  it('does not flag position checks like > 5', () => {
    expect(detect(ctx('arr.indexOf(2) > 5\n'))).toHaveLength(0);
  });
  it('does not flag === 3 (position equality)', () => {
    expect(detect(ctx('arr.indexOf(2) === 3\n'))).toHaveLength(0);
  });
  it('does not flag !== 0 (position check)', () => {
    expect(detect(ctx('arr.indexOf(2) !== 0\n'))).toHaveLength(0);
  });
  it('emits high confidence', () => {
    const f = detect(ctx('arr.indexOf(2) !== -1\n'));
    expect(f[0]!.confidence).toBe('high');
  });
});
