import { describe, it, expect } from 'vitest';
import { parsePython } from '../../../../../src/analyze/parser.js';
import { detect } from '../../../../../src/analyze/detectors/python/old-string-format.js';

const ctx = (s: string) => ({
  absPath: '/x/a.py',
  relPath: 'a.py',
  source: s,
  tree: parsePython(s),
});

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

  it('anchors a single-line % finding on the % operator', () => {
    // line 1 blank, line 2 the statement
    const f = detect(ctx('\nx = "hi %s" % name\n'));
    expect(f).toHaveLength(1);
    expect(f[0]!.line).toBe(2);
  });

  it('anchors a multi-line % finding on the operator, not the string start', () => {
    const src = 'x = """\nline a\nline b\n""" % name\n';
    const f = detect(ctx(src));
    expect(f).toHaveLength(1);
    // The `"""` opens on line 1; the `%` is on line 4 — the finding must
    // point at the operator, where the formatting is actually visible.
    expect(f[0]!.line).toBe(4);
  });

  it('anchors a multi-line .format() finding on the .format token', () => {
    const src = 'x = """\nline a\nline b\n""".format(name)\n';
    const f = detect(ctx(src));
    expect(f).toHaveLength(1);
    expect(f[0]!.line).toBe(4);
  });
});
