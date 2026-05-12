import { describe, it, expect } from 'vitest';
import { parseTypescript } from '../../../../../src/analyze/parser.js';
import { detect } from '../../../../../src/analyze/detectors/typescript/promise-chains.js';

const ctx = (s: string) => ({
  absPath: '/x/a.ts',
  relPath: 'a.ts',
  source: s,
  tree: parseTypescript(s, false),
});

describe('ts: promise-chains', () => {
  it('flags .then().then()', () => {
    expect(detect(ctx('fetch("x").then(r => r.json()).then(j => j.id);\n'))).toHaveLength(1);
  });
  it('skips single .then', () => {
    expect(detect(ctx('fetch("x").then(r => r);\n'))).toHaveLength(0);
  });
});
