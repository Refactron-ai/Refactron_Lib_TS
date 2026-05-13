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
