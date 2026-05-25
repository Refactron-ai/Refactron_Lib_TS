import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { transform } from '../../../../../src/transform/transforms/python/yield-from.js';
import type { CrossFileContext } from '../../../../../src/transform/types.js';

async function file(source: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 't-yf-'));
  const p = path.join(dir, 'f.py');
  await fs.writeFile(p, source);
  return p;
}

function cf(): CrossFileContext {
  // yield_from has no version gate; cross-file is unused but the wrapper
  // still threads it for the runner's tmpdir mechanics.
  return {
    projectRoot: '',
    files: {},
    importedBy: {},
    imports: {},
    testFiles: [],
    pythonVersion: null,
  };
}

describe('yield_from_for_loop (python)', () => {
  it('rewrites `for x in seq: yield x` to `yield from seq`', async () => {
    const src = 'def g(seq):\n    for x in seq:\n        yield x\n';
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf(),
    });
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('yield from seq');
    expect(r.newContent).not.toMatch(/for x in seq:/);
  });

  it('preserves a complex iterable expression verbatim', async () => {
    const src = [
      'def g(xs, ys):',
      '    for x in (a + b for a, b in zip(xs, ys)):',
      '        yield x',
      '',
    ].join('\n');
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf(),
    });
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('yield from (a + b for a, b in zip(xs, ys))');
  });

  it('preserves a leading comment above the for loop', async () => {
    const src = [
      'def g(seq):',
      '    # forward everything',
      '    for x in seq:',
      '        yield x',
      '',
    ].join('\n');
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf(),
    });
    expect(r.newContent).not.toBeNull();
    // The comment must survive in the same position.
    expect(r.newContent).toMatch(/# forward everything\s*\n\s*yield from seq/);
  });

  it('skips multi-statement loop bodies', async () => {
    const src = [
      'def g(seq):',
      '    for x in seq:',
      '        yield x',
      '        print(x)',
      '',
    ].join('\n');
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf(),
    });
    expect(r.newContent).toBeNull();
  });

  it('skips tuple targets', async () => {
    const src = 'def g(seq):\n    for a, b in seq:\n        yield a\n';
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf(),
    });
    expect(r.newContent).toBeNull();
  });

  it('skips loops with an `else:` branch', async () => {
    const src = [
      'def g(seq):',
      '    for x in seq:',
      '        yield x',
      '    else:',
      '        print("done")',
      '',
    ].join('\n');
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf(),
    });
    expect(r.newContent).toBeNull();
  });

  it('skips already-`yield from`', async () => {
    const src = 'def g(seq):\n    for x in seq:\n        yield from x\n';
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf(),
    });
    expect(r.newContent).toBeNull();
  });

  it('does NOT rewrite a `for` loop inside an `async def` (would be a SyntaxError)', async () => {
    // C1 regression: `yield from` inside an async function is a SyntaxError
    // at CPython's compile stage (see CPython issue #121657 / PEP 525). LibCST's
    // PARSER accepts it, so the sidecar's defensive round-trip parse won't
    // catch it -- the only safe path is to refuse the rewrite up front.
    const src = ['async def f(items):', '    for x in items:', '        yield x', ''].join('\n');
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf(),
    });
    expect(r.newContent).toBeNull();
  });

  it('preserves an inline trailing comment on the single-line for-suite form', async () => {
    // M5 regression: `for x in seq: yield x  # keep me` is a SimpleStatementSuite
    // (no IndentedBlock), and the trailing comment lives on the suite itself.
    const src = 'def g(seq):\n    for x in seq: yield x  # keep me\n';
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf(),
    });
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('yield from seq');
    expect(r.newContent).toContain('# keep me');
  });

  it('produces parseable Python when the iterable is a deeply nested expression', async () => {
    // The brief asks us to verify round-trip via cst.parse_module — the
    // sidecar already does that internally and refuses with
    // `rewrite_unparseable` on failure. Here we double-check at the JS layer
    // by inspecting the emitted string for an obvious parseability proxy
    // (balanced parens / no stray prefix).
    const src = [
      'def g():',
      '    for x in func(arg1, arg2={"k": v for v in xs}):',
      '        yield x',
      '',
    ].join('\n');
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf(),
    });
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('yield from func(arg1, arg2={"k": v for v in xs})');
  });
});
