import { describe, it, expect } from 'vitest';
import { parseTypescript } from '../../../../../src/analyze/parser.js';
import { detect } from '../../../../../src/analyze/detectors/typescript/object-assign-empty.js';

const ctx = (s: string) => ({
  absPath: '/x/a.ts',
  relPath: 'a.ts',
  source: s,
  tree: parseTypescript(s, false),
});

describe('ts: object-assign-empty', () => {
  it('flags Object.assign({}, a, b)', () => {
    expect(detect(ctx('Object.assign({}, a, b)\n'))).toHaveLength(1);
  });
  it('flags Object.assign({ base: 1 }, a)', () => {
    expect(detect(ctx('Object.assign({ base: 1 }, a)\n'))).toHaveLength(1);
  });
  it('does not flag Object.assign(myObj, a)', () => {
    expect(detect(ctx('Object.assign(myObj, a)\n'))).toHaveLength(0);
  });
  it('does not flag My.assign({}, a)', () => {
    expect(detect(ctx('My.assign({}, a)\n'))).toHaveLength(0);
  });
  it('emits high confidence', () => {
    const f = detect(ctx('Object.assign({}, a)\n'));
    expect(f[0]!.confidence).toBe('high');
  });
});
