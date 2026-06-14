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
    expect(r.preconditions.some((c) => c.satisfied && /annotated:handle:x/.test(c.id))).toBe(true);
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

  // Regression for issue #57: the four "silent return updated" paths in
  // leave_FunctionDef used to vanish without trace. Every isinstance-bearing
  // function the rewriter refuses must now leave a record so the user can see
  // why a finding produced no change. Functions WITHOUT an isinstance chain
  // remain silent (they're not candidates — emitting noise for unrelated
  // siblings would drown the real signal on a large file).

  it('emits a precondition when an isinstance-bearing function body has more than one statement', async () => {
    // The dominant Ansible failure mode: dispatcher followed by a fallthrough
    // raise/return. Detector flags `boolean(value)` etc.; sidecar silently
    // bails because the if-chain isn't the sole body statement.
    const src =
      'def handle(x):\n' +
      '    if isinstance(x, int):\n' +
      '        return x + 1\n' +
      '    elif isinstance(x, str):\n' +
      '        return x.upper()\n' +
      '    raise TypeError("bad")\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toBeNull();
    expect(
      r.preconditions.some(
        (c) => !c.satisfied && /body-not-pure-dispatcher:handle/.test(c.id),
      ),
    ).toBe(true);
  });

  it('emits a precondition when an isinstance-bearing function has a leading docstring', async () => {
    // Docstrings count as a body statement; _body_stmts_no_pass only strips
    // `pass`. With a docstring + chain, meaningful=2 → would previously bail
    // silently. Same precondition id as the multi-statement case — the user
    // cares "you saw it, you refused it, here's the rough why".
    const src =
      'def handle(x):\n' +
      '    """Dispatch on the type of x."""\n' +
      '    if isinstance(x, int):\n' +
      '        return x + 1\n' +
      '    elif isinstance(x, str):\n' +
      '        return x.upper()\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toBeNull();
    expect(
      r.preconditions.some(
        (c) => !c.satisfied && /body-not-pure-dispatcher:handle/.test(c.id),
      ),
    ).toBe(true);
  });

  it("emits a precondition when an isinstance-bearing function's lone statement isn't an if", async () => {
    // `def f(x): return isinstance(x, int)` — meaningful=1, lone stmt is a
    // Return, not an If. Previously a silent bail.
    const src = 'def handle(x):\n    return isinstance(x, int)\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toBeNull();
    expect(
      r.preconditions.some(
        (c) => !c.satisfied && /lone-statement-not-if:handle/.test(c.id),
      ),
    ).toBe(true);
  });

  it('stays silent for functions with NO isinstance call at all', async () => {
    // Gate check: an unrelated function in the same file must not generate
    // noise. Without this, a 50-function file would emit 49 spurious refusals
    // around the single real candidate.
    const src =
      'def unrelated(x):\n' +
      '    if x > 0:\n' +
      '        return x\n' +
      '    return 0\n' +
      '\n' +
      'def handle(x):\n' +
      '    if isinstance(x, int):\n' +
      '        return 1\n' +
      '    elif isinstance(x, str):\n' +
      '        return 2\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).not.toBeNull();
    expect(r.preconditions.every((c) => !/unrelated/.test(c.id))).toBe(true);
  });
});
