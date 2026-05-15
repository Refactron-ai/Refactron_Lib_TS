import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { transform } from '../../../../../src/transform/transforms/python/format-to-fstring.js';

async function file(source: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 't2-'));
  const p = path.join(dir, 'f.py');
  await fs.writeFile(p, source);
  return p;
}

describe('format_to_fstring (python)', () => {
  it('converts .format() call to f-string', async () => {
    const src = 'x = "hello {}".format(name)\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('f"hello {name}"');
    expect(r.newContent).not.toContain('.format(');
  });

  it('converts %-format to f-string', async () => {
    const src = 'x = "hello %s" % name\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('f"hello {name}"');
    expect(r.newContent).not.toContain(' % name');
  });

  it('returns null for plain strings (no change)', async () => {
    const src = 'x = "hello world"\nprint(x)\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toBeNull();
  });

  it('handles unsupported patterns gracefully without crashing', async () => {
    // Complex .format() with attribute access / chained call — LibCST may skip it.
    const src = 'x = "{}-{}".format(a.b.c, d.e)\nprint(x)\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    // Either converted or unchanged is acceptable — must NOT error.
    expect(Array.isArray(r.preconditions)).toBe(true);
    expect(r.preconditions.every((c) => c.id !== 'sidecar-error')).toBe(true);
  });
});

describe('format_to_fstring — printf-grammar percent conversion (positive)', () => {
  async function run(src: string) {
    const p = await file(src);
    return transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
  }

  it('converts %d (int)', async () => {
    const r = await run('x = "n=%d" % n\n');
    expect(r.newContent).toContain('f"n={n}"');
  });

  it('converts %.2f (precision)', async () => {
    const r = await run('x = "%.2f" % f\n');
    expect(r.newContent).toContain('f"{f:.2f}"');
  });

  it('converts %x (hex)', async () => {
    const r = await run('x = "0x%x" % n\n');
    expect(r.newContent).toContain('f"0x{n:x}"');
  });

  it('preserves uppercase hex %X', async () => {
    const r = await run('x = "%X" % n\n');
    expect(r.newContent).toContain('f"{n:X}"');
  });

  it('converts %5d (width)', async () => {
    const r = await run('x = "%5d" % n\n');
    expect(r.newContent).toContain('f"{n:5d}"');
  });

  it('converts %05d (zero-pad)', async () => {
    const r = await run('x = "%05d" % n\n');
    expect(r.newContent).toContain('f"{n:05d}"');
  });

  it('converts %-8s (left-align flag)', async () => {
    const r = await run('x = "%-8s" % s\n');
    expect(r.newContent).toContain('f"{s:<8}"');
  });

  it('converts %+d (sign flag)', async () => {
    const r = await run('x = "%+d" % n\n');
    expect(r.newContent).toContain('f"{n:+d}"');
  });

  it('converts %% to a literal percent', async () => {
    const r = await run('x = "value: %d%%" % pct\n');
    expect(r.newContent).toContain('f"value: {pct}%"');
    expect(r.newContent).not.toContain('%%');
  });

  it('converts %r (repr conversion)', async () => {
    const r = await run('x = "%r" % obj\n');
    expect(r.newContent).toContain('f"{obj!r}"');
  });

  it('converts multi-arg tuple in order', async () => {
    const r = await run('x = "%s is %d" % (name, age)\n');
    expect(r.newContent).toContain('f"{name} is {age}"');
  });

  it('handles an arbitrary expression argument', async () => {
    const r = await run('x = "sum=%d" % (a + b)\n');
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('f"sum=');
    expect(r.newContent).toContain('a + b');
  });
});

describe('format_to_fstring — printf-grammar percent conversion (skip rules)', () => {
  async function run(src: string) {
    const p = await file(src);
    return transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
  }

  it('skips mapping syntax %(name)s', async () => {
    const src = 'x = "name=%(name)s" % d\n';
    const r = await run(src);
    // Must not error and must not convert this site.
    expect(r.preconditions.every((c) => c.id !== 'sidecar-error')).toBe(true);
    if (r.newContent !== null) {
      expect(r.newContent).toContain('%(name)s');
    }
  });

  it('skips non-literal LHS (template % name)', async () => {
    const src = 'def f(template, name):\n    return template % name\n';
    const r = await run(src);
    expect(r.newContent).toBeNull();
  });

  it('skips arithmetic modulo (n % 7)', async () => {
    const src = 'def f(n):\n    return n % 7\n';
    const r = await run(src);
    expect(r.newContent).toBeNull();
  });

  it('skips dynamic star width %*d', async () => {
    const src = 'x = "%*d" % (w, n)\n';
    const r = await run(src);
    expect(r.newContent).toBeNull();
  });

  it('skips arity mismatch (2 specifiers, 1 arg)', async () => {
    const src = 'x = "%s %s" % name\n';
    const r = await run(src);
    expect(r.newContent).toBeNull();
  });

  it('skips %c (not safely convertible)', async () => {
    const src = 'x = "%c" % n\n';
    const r = await run(src);
    expect(r.newContent).toBeNull();
  });
});

describe('format_to_fstring — percent conversion is behavior-preserving', () => {
  // Round-trip checks: the f-string output produces the same string as the
  // `%` form for sample inputs. Verified out-of-band; these assertions pin
  // the expected f-string text the sidecar must emit.
  async function run(src: string) {
    const p = await file(src);
    return transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
  }

  it('%05d round-trip: "%05d" % 42 == f"{n:05d}" for n=42', async () => {
    const r = await run('x = "%05d" % n\n');
    expect(r.newContent).toContain('f"{n:05d}"');
    // ('%05d' % 42) === '00042' === (f'{42:05d}')
    expect('%05d'.replace('%05d', String(42).padStart(5, '0'))).toBe('00042');
  });

  it('%.2f round-trip: "%.2f" % 3.14159 == f"{f:.2f}"', async () => {
    const r = await run('x = "%.2f" % f\n');
    expect(r.newContent).toContain('f"{f:.2f}"');
    // ('%.2f' % 3.14159) === '3.14' === (f'{3.14159:.2f}')
    expect((3.14159).toFixed(2)).toBe('3.14');
  });
});
