import { describe, it, expect } from 'vitest';
import { parsePython } from '../../../../../src/analyze/parser.js';
import { detect } from '../../../../../src/analyze/detectors/python/class-init-only.js';

const ctx = (s: string) => ({ absPath: '/x/a.py', relPath: 'a.py', source: s, tree: parsePython(s) });

describe('python: class-init-only', () => {
  it('flags pure assignment __init__', () => {
    const src = `class User:
    def __init__(self, id, name):
        self.id = id
        self.name = name
`;
    const f = detect(ctx(src));
    expect(f.length).toBe(1);
    expect(f[0]!.transformId).toBe('class_to_dataclass');
    expect(f[0]!.confidence).toBe('high');
  });
  it('skips class with additional methods', () => {
    const src = `class User:
    def __init__(self, id):
        self.id = id
    def greet(self):
        return self.id
`;
    expect(detect(ctx(src))).toHaveLength(0);
  });
  it('skips class with non-trivial __init__', () => {
    const src = `class User:
    def __init__(self, id):
        self.id = id * 2
`;
    expect(detect(ctx(src))).toHaveLength(0);
  });
});
