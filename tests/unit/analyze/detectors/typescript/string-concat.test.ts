import { describe, it, expect } from 'vitest';
import { parseTypescript } from '../../../../../src/analyze/parser.js';
import { detect } from '../../../../../src/analyze/detectors/typescript/string-concat.js';

const ctx = (s: string) => ({
  absPath: '/x/a.ts',
  relPath: 'a.ts',
  source: s,
  tree: parseTypescript(s, false),
});

describe('ts: string-concat', () => {
  it('flags "hi " + name', () => {
    expect(detect(ctx('const g = "hi " + name\n'))).toHaveLength(1);
  });
  it('flags chain "a" + b + "c"', () => {
    // The outer node is the one we flag — only one finding per chain.
    expect(detect(ctx('const g = "a" + b + "c"\n'))).toHaveLength(1);
  });
  it('does not flag pure numeric a + b', () => {
    expect(detect(ctx('const g = a + b\n'))).toHaveLength(0);
  });
  it('does not flag string method calls', () => {
    expect(detect(ctx('const g = "hi".repeat(2)\n'))).toHaveLength(0);
  });
  it('emits medium confidence', () => {
    const f = detect(ctx('const g = "hi " + name\n'));
    expect(f[0]!.confidence).toBe('medium');
  });
});
