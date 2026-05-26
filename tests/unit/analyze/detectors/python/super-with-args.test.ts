import { describe, it, expect } from 'vitest';
import { parsePython } from '../../../../../src/analyze/parser.js';
import { detect } from '../../../../../src/analyze/detectors/python/super-with-args.js';

const ctx = (s: string) => ({
  absPath: '/x/a.py',
  relPath: 'a.py',
  source: s,
  tree: parsePython(s),
});

describe('python: super-with-args detector', () => {
  it('detects super(Class, self).method()', () => {
    const src = 'class B(A):\n    def f(self):\n        super(B, self).f()\n';
    const f = detect(ctx(src));
    expect(f).toHaveLength(1);
    expect(f[0]!.transformId).toBe('super_no_args');
    expect(f[0]!.confidence).toBe('high');
  });

  it('detects super(Class, self).method(arg)', () => {
    const src = 'class B(A):\n    def f(self, x):\n        super(B, self).f(x)\n';
    expect(detect(ctx(src))).toHaveLength(1);
  });

  it('skips zero-arg super()', () => {
    const src = 'class B(A):\n    def f(self):\n        super().f()\n';
    expect(detect(ctx(src))).toHaveLength(0);
  });

  it('skips classmethod super(Class, cls) — out of scope for v0.2.3', () => {
    const src = 'class B(A):\n    @classmethod\n    def g(cls):\n        super(B, cls).g()\n';
    expect(detect(ctx(src))).toHaveLength(0);
  });

  it('skips super(type(self), self)', () => {
    const src = 'class B(A):\n    def f(self):\n        super(type(self), self).f()\n';
    // First arg is a Call, not an Identifier — must not match.
    expect(detect(ctx(src))).toHaveLength(0);
  });

  it('anchors finding on the super() call site', () => {
    const src = '\n\nclass B(A):\n    def f(self):\n        super(B, self).f()\n';
    const f = detect(ctx(src));
    expect(f).toHaveLength(1);
    expect(f[0]!.line).toBe(5);
  });
});
