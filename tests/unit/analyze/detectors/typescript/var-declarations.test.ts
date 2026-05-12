import { describe, it, expect } from 'vitest';
import { parseTypescript } from '../../../../../src/analyze/parser.js';
import { detect } from '../../../../../src/analyze/detectors/typescript/var-declarations.js';

const ctx = (s: string) => ({
  absPath: '/x/a.ts',
  relPath: 'a.ts',
  source: s,
  tree: parseTypescript(s, false),
});

describe('ts: var-declarations', () => {
  it('flags var', () => {
    expect(detect(ctx('var x = 1;\n'))).toHaveLength(1);
  });
  it('does not flag let or const', () => {
    expect(detect(ctx('let x = 1;\nconst y = 2;\n'))).toHaveLength(0);
  });
  it('marks reassigned var medium-confidence', () => {
    const f = detect(ctx('var x = 1;\nx = 2;\n'));
    expect(f[0]!.confidence).toBe('medium');
  });
  it('marks never-reassigned var high-confidence', () => {
    const f = detect(ctx('var x = 1;\nconsole.log(x);\n'));
    expect(f[0]!.confidence).toBe('high');
  });
});
