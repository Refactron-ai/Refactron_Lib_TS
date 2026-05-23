import { describe, it, expect } from 'vitest';
import { parsePython } from '../../../../../src/analyze/parser.js';
import { detect } from '../../../../../src/analyze/detectors/python/lru-cache-maxsize-none.js';

const ctx = (s: string) => ({
  absPath: '/x/a.py',
  relPath: 'a.py',
  source: s,
  tree: parsePython(s),
});

describe('python: lru-cache-maxsize-none detector', () => {
  it('detects @functools.lru_cache(maxsize=None)', () => {
    const src = 'import functools\n@functools.lru_cache(maxsize=None)\ndef f(x):\n    return x\n';
    const f = detect(ctx(src));
    expect(f).toHaveLength(1);
    expect(f[0]!.transformId).toBe('lru_cache_to_cache');
    expect(f[0]!.confidence).toBe('high');
  });

  it('detects @lru_cache(maxsize=None) after from-import', () => {
    const src =
      'from functools import lru_cache\n@lru_cache(maxsize=None)\ndef f(x):\n    return x\n';
    expect(detect(ctx(src))).toHaveLength(1);
  });

  it('skips @lru_cache(maxsize=128)', () => {
    const src =
      'from functools import lru_cache\n@lru_cache(maxsize=128)\ndef f(x):\n    return x\n';
    expect(detect(ctx(src))).toHaveLength(0);
  });

  it('skips @lru_cache() with no args', () => {
    const src = 'from functools import lru_cache\n@lru_cache()\ndef f(x):\n    return x\n';
    expect(detect(ctx(src))).toHaveLength(0);
  });

  it('skips lru_cache without an import', () => {
    // Without confirming the import we cannot trust the symbol.
    const src = '@lru_cache(maxsize=None)\ndef f(x):\n    return x\n';
    expect(detect(ctx(src))).toHaveLength(0);
  });
});
