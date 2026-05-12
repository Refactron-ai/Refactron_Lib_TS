import { describe, it, expect } from 'vitest';
import { parsePython } from '../../../../../src/analyze/parser.js';
import { detect } from '../../../../../src/analyze/detectors/python/old-string-format.js';

const ctx = (s: string) => ({ absPath: '/x/a.py', relPath: 'a.py', source: s, tree: parsePython(s) });

describe('python: old-string-format', () => {
  it('detects % formatting', () => {
    const f = detect(ctx('x = "hello %s" % name\n'));
    expect(f.length).toBe(1);
    expect(f[0]!.transformId).toBe('format_to_fstring');
    expect(f[0]!.confidence).toBe('high');
  });
  it('detects .format() on string literal', () => {
    expect(detect(ctx('x = "{} {}".format(a, b)\n'))).toHaveLength(1);
  });
  it('skips arithmetic modulo', () => {
    expect(detect(ctx('x = 5 % 2\n'))).toHaveLength(0);
  });
  it('skips .format() on non-strings', () => {
    expect(detect(ctx('x = obj.format(a)\n'))).toHaveLength(0);
  });
});
