import { describe, it, expect } from 'vitest';
import { parsePython } from '../../../../../src/analyze/parser.js';
import { detect } from '../../../../../src/analyze/detectors/python/manual-typecheck.js';

const ctx = (s: string) => ({
  absPath: '/x/a.py',
  relPath: 'a.py',
  source: s,
  tree: parsePython(s),
});

describe('python: manual-typecheck', () => {
  it('flags isinstance chain dispatching function body', () => {
    const src = `def area(shape):
    if isinstance(shape, Circle):
        return shape.r * shape.r * 3.14
    elif isinstance(shape, Square):
        return shape.side * shape.side
`;
    const f = detect(ctx(src));
    expect(f.length).toBe(1);
    expect(f[0]!.transformId).toBe('manual_typecheck_to_hints');
    expect(f[0]!.confidence).toBe('medium');
  });
  it('skips one-off isinstance check', () => {
    expect(
      detect(ctx('def f(x):\n    if isinstance(x, str):\n        return 1\n    return 2\n')),
    ).toHaveLength(0);
  });
});
