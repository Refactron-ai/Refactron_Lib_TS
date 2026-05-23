import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { transform } from '../../../../../src/transform/transforms/python/super-no-args.js';

async function file(source: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 't-super-'));
  const p = path.join(dir, 'f.py');
  await fs.writeFile(p, source);
  return p;
}

describe('super_no_args (python)', () => {
  it('rewrites super(Class, self).method() in a matching class', async () => {
    const src = 'class B(A):\n    def f(self):\n        super(B, self).f()\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('super().f()');
    expect(r.newContent).not.toContain('super(B, self)');
  });

  it('preserves call arguments', async () => {
    const src = 'class B(A):\n    def f(self, x, y):\n        super(B, self).g(x, y)\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toContain('super().g(x, y)');
  });

  it('skips when the class-name does not match the enclosing class', async () => {
    // `super(A, self)` inside class B (deliberately wrong) must NOT be rewritten:
    // rewriting it to `super()` would change MRO behaviour.
    const src = 'class B(A):\n    def f(self):\n        super(A, self).f()\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toBeNull();
  });

  it('skips classmethod super(Class, cls) — second arg must be self', async () => {
    const src = 'class B(A):\n    @classmethod\n    def g(cls):\n        super(B, cls).g()\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toBeNull();
  });

  it('does NOT rewrite super(Outer, self) inside a nested class shadow', async () => {
    // `super()` in `Inner.f` would resolve against Inner, not Outer — so
    // rewriting `super(Outer, self)` to `super()` would change behaviour.
    const src = [
      'class Outer:',
      '    class Inner:',
      '        def f(self):',
      '            super(Outer, self).f()',
      '',
    ].join('\n');
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toBeNull();
  });

  it('returns null for code that has no super() calls', async () => {
    const src = 'def f():\n    return 1\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toBeNull();
  });

  it('rewrites multiple sites in the same class', async () => {
    const src =
      'class B(A):\n' +
      '    def f(self):\n' +
      '        super(B, self).f()\n' +
      '    def g(self):\n' +
      '        super(B, self).g()\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).not.toContain('super(B, self)');
    // Two super() calls survive
    const matches = (r.newContent!.match(/super\(\)/g) || []).length;
    expect(matches).toBe(2);
  });

  it('skips module-level super(Class, self) (no enclosing class)', async () => {
    const src = 'super(A, self).f()\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toBeNull();
  });

  // Review finding M1 — explicit coverage that a sibling/parent class name
  // (here `A`) inside a method of class `B(A)` is NOT rewritten. The code
  // skips this via the name-mismatch guard (innermost class is `B`, first
  // arg is `A`), but we want a regression test that fails the moment
  // someone weakens that guard.
  it('skips super(A, self) where A is a parent/sibling, not the enclosing class', async () => {
    const src = [
      'class A:',
      '    pass',
      '',
      'class B(A):',
      '    def f(self):',
      '        super(A, self).f()',
      '',
    ].join('\n');
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toBeNull();
  });

  // Review finding M3 — `super(__class__, self)` uses the magic `__class__`
  // cell. The literal class-name match never succeeds (the innermost class
  // is never named `__class__`), so the transform correctly skips. A future
  // version may handle this form; tracked by the # TODO in the sidecar.
  it('skips super(__class__, self) (magic __class__ form is deferred to v0.4)', async () => {
    const src = ['class B(A):', '    def f(self):', '        super(__class__, self).f()', ''].join(
      '\n',
    );
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toBeNull();
  });

  // Review finding M3 — `super(type(self), self)` is also out of scope.
  // The first arg is a Call node (`type(self)`), not a Name, so the
  // `isinstance(first, cst.Name)` guard skips cleanly.
  it('skips super(type(self), self) (Call-typed first arg is intentionally not rewritten)', async () => {
    const src = ['class B(A):', '    def f(self):', '        super(type(self), self).f()', ''].join(
      '\n',
    );
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toBeNull();
  });
});
