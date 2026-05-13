import { describe, it, expect } from 'vitest';
import { parseTypescript } from '../../../../../src/analyze/parser.js';
import { detect } from '../../../../../src/analyze/detectors/typescript/implicit-any.js';

const ctx = (s: string) => ({
  absPath: '/x/a.ts',
  relPath: 'a.ts',
  source: s,
  tree: parseTypescript(s, false),
});

describe('ts: implicit-any', () => {
  it('flags untyped parameter', () => {
    expect(detect(ctx('function add(a, b) { return a + b; }\n'))).toHaveLength(2);
  });
  it('skips typed parameters', () => {
    expect(detect(ctx('function add(a: number, b: number) { return a + b; }\n'))).toHaveLength(0);
  });
  it('skips parameters with default value (type can be inferred)', () => {
    expect(detect(ctx('function f(a = 1) { return a; }\n'))).toHaveLength(0);
  });
});
