import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { transform } from '../../../../../src/transform/transforms/python/manual-typecheck.js';

async function file(source: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 't3-'));
  const p = path.join(dir, 'f.py');
  await fs.writeFile(p, source);
  return p;
}

describe('manual_typecheck_to_hints (python)', () => {
  it('annotates a parameter with Union[...] from an isinstance chain', async () => {
    const src =
      'def handle(x):\n' +
      '    if isinstance(x, int):\n' +
      '        return x + 1\n' +
      '    elif isinstance(x, str):\n' +
      '        return x.upper()\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('def handle(x: Union[int, str])');
    expect(r.newContent).toContain('from typing import Union');
    expect(
      r.preconditions.some((c) => c.satisfied && /annotated:handle:x/.test(c.id)),
    ).toBe(true);
  });

  it('fails preconditions when the parameter is already annotated', async () => {
    const src = 'def handle(x: int):\n    if isinstance(x, int):\n        return x + 1\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toBeNull();
    expect(
      r.preconditions.some(
        (c) => !c.satisfied && /already has a type annotation/.test(c.reason ?? ''),
      ),
    ).toBe(true);
  });

  it('fails preconditions when the chain discriminates different parameters', async () => {
    const src =
      'def handle(x, y):\n' +
      '    if isinstance(x, int):\n' +
      '        return x\n' +
      '    elif isinstance(y, str):\n' +
      '        return y\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toBeNull();
    expect(
      r.preconditions.some(
        (c) => !c.satisfied && /does not discriminate a single parameter/.test(c.reason ?? ''),
      ),
    ).toBe(true);
  });
});
