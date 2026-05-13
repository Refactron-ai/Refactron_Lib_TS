import { describe, it, expect } from 'vitest';
import { parseTypescript } from '../../../../../src/analyze/parser.js';
import { detect } from '../../../../../src/analyze/detectors/typescript/promise-constructor.js';

const ctx = (s: string) => ({
  absPath: '/x/a.ts',
  relPath: 'a.ts',
  source: s,
  tree: parseTypescript(s, false),
});

describe('ts: promise-constructor', () => {
  it('flags new Promise(...)', () => {
    expect(detect(ctx('const p = new Promise((resolve) => resolve(1));\n'))).toHaveLength(1);
  });
  it('does not flag Promise.resolve', () => {
    expect(detect(ctx('const p = Promise.resolve(1);\n'))).toHaveLength(0);
  });
});
