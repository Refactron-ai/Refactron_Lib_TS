import { describe, it, expect } from 'vitest';
import { parsePython } from '../../../../../src/analyze/parser.js';
import { detect } from '../../../../../src/analyze/detectors/python/yield-in-trivial-loop.js';

const ctx = (s: string) => ({
  absPath: '/x/a.py',
  relPath: 'a.py',
  source: s,
  tree: parsePython(s),
});

describe('python: yield-in-trivial-loop detector', () => {
  it('detects `for x in seq: yield x`', () => {
    const src = 'def g(seq):\n    for x in seq:\n        yield x\n';
    const f = detect(ctx(src));
    expect(f).toHaveLength(1);
    expect(f[0]!.transformId).toBe('yield_from_for_loop');
    expect(f[0]!.confidence).toBe('high');
  });

  it('skips `for x in seq: yield f(x)` (yielded value is not bare loop var)', () => {
    const src = 'def g(seq):\n    for x in seq:\n        yield f(x)\n';
    expect(detect(ctx(src))).toHaveLength(0);
  });

  it('skips tuple targets `for a, b in seq: yield a`', () => {
    const src = 'def g(seq):\n    for a, b in seq:\n        yield a\n';
    expect(detect(ctx(src))).toHaveLength(0);
  });

  it('skips loops with an `else:` branch', () => {
    const src = [
      'def g(seq):',
      '    for x in seq:',
      '        yield x',
      '    else:',
      '        print("done")',
      '',
    ].join('\n');
    expect(detect(ctx(src))).toHaveLength(0);
  });

  it('skips loops that are already `yield from`', () => {
    const src = 'def g(seq):\n    for x in seq:\n        yield from x\n';
    expect(detect(ctx(src))).toHaveLength(0);
  });

  it('skips multi-statement loop bodies', () => {
    const src = [
      'def g(seq):',
      '    for x in seq:',
      '        yield x',
      '        print(x)',
      '',
    ].join('\n');
    expect(detect(ctx(src))).toHaveLength(0);
  });

  it('skips when body is not a yield at all', () => {
    const src = 'def g(seq):\n    for x in seq:\n        print(x)\n';
    expect(detect(ctx(src))).toHaveLength(0);
  });

  it('skips when the yielded name does not match the loop variable', () => {
    const src = 'def g(seq, other):\n    for x in seq:\n        yield other\n';
    expect(detect(ctx(src))).toHaveLength(0);
  });

  it('skips `for` loops inside `async def` bodies (yield-from is a SyntaxError there)', () => {
    // C1 regression: rewriting to `yield from` inside `async def` would emit
    // code that fails to compile (CPython enforces it at compile time, not
    // parse time, so neither tree-sitter nor LibCST raises).
    const src = ['async def f(items):', '    for x in items:', '        yield x', ''].join('\n');
    expect(detect(ctx(src))).toHaveLength(0);
  });

  it('skips `async for x in aiter: yield x` (async-for can only live inside async def)', () => {
    // tree-sitter-python uses one `for_statement` rule for both `for` and
    // `async for`; the async-for variant is only valid in async generators
    // and `yield from` is illegal there.
    const src = ['async def f(aiter):', '    async for x in aiter:', '        yield x', ''].join(
      '\n',
    );
    expect(detect(ctx(src))).toHaveLength(0);
  });

  it('nested for-loops: outer does NOT match, inner DOES match', () => {
    // The outer loop's body is itself a `for` statement (not a yield), so
    // only the inner trivial-yield should be detected.
    const src = [
      'def g(outer):',
      '    for x in outer:',
      '        for y in x:',
      '            yield y',
      '',
    ].join('\n');
    const f = detect(ctx(src));
    expect(f).toHaveLength(1);
    // The inner `for y in x:` starts on the 3rd line of the function body
    // (1-indexed line 3 of the source = `    for y in x:`).
    expect(f[0]!.line).toBe(3);
  });
});
