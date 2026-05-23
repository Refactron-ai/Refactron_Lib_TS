import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { transform } from '../../../../../src/transform/transforms/python/lru-cache-to-cache.js';
import type { CrossFileContext } from '../../../../../src/transform/types.js';

async function file(source: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 't-lru-'));
  const p = path.join(dir, 'f.py');
  await fs.writeFile(p, source);
  return p;
}

function cf(pythonVersion: string | null): CrossFileContext {
  return {
    projectRoot: '',
    files: {},
    importedBy: {},
    imports: {},
    testFiles: [],
    pythonVersion,
  };
}

describe('lru_cache_to_cache (python) — version gate', () => {
  it('refuses when pythonVersion is unknown (null)', async () => {
    const src = 'import functools\n@functools.lru_cache(maxsize=None)\ndef f(x):\n    return x\n';
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf(null),
    });
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((c) => c.id === 'python_version_too_low' && !c.satisfied)).toBe(
      true,
    );
  });

  it('refuses on Python 3.8', async () => {
    const src = 'import functools\n@functools.lru_cache(maxsize=None)\ndef f(x):\n    return x\n';
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.8'),
    });
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((c) => c.id === 'python_version_too_low' && !c.satisfied)).toBe(
      true,
    );
  });

  it('refuses when no crossFile is provided at all', async () => {
    // The wrapper writes a stub cross-file with pythonVersion=null when the
    // engine didn't supply one, so the sidecar still refuses cleanly.
    const src = 'import functools\n@functools.lru_cache(maxsize=None)\ndef f(x):\n    return x\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((c) => c.id === 'python_version_too_low' && !c.satisfied)).toBe(
      true,
    );
  });
});

describe('lru_cache_to_cache (python) — rewrites on Python >= 3.9', () => {
  it('rewrites @functools.lru_cache(maxsize=None) to @functools.cache', async () => {
    const src = 'import functools\n@functools.lru_cache(maxsize=None)\ndef f(x):\n    return x\n';
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.9'),
    });
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('@functools.cache');
    expect(r.newContent).not.toContain('lru_cache(maxsize=None)');
  });

  it('rewrites bare @lru_cache(maxsize=None) and updates the import', async () => {
    const src =
      'from functools import lru_cache\n@lru_cache(maxsize=None)\ndef f(x):\n    return x\n';
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.11'),
    });
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('@cache');
    // The lru_cache import should be replaced by cache, since no `lru_cache`
    // references survive.
    expect(r.newContent).toContain('from functools import cache');
    expect(r.newContent).not.toContain('lru_cache');
  });

  it('keeps lru_cache import and adds cache when another @lru_cache(128) survives', async () => {
    const src = [
      'from functools import lru_cache',
      '@lru_cache(maxsize=None)',
      'def f(x):',
      '    return x',
      '@lru_cache(maxsize=128)',
      'def g(x):',
      '    return x',
      '',
    ].join('\n');
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.10'),
    });
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('@cache');
    // Stronger than a substring check: the augmented import must be a
    // well-formed `from functools import lru_cache, cache` line — a
    // substring-only assertion would happily pass for a corrupted import.
    expect(r.newContent).toMatch(/^from functools import lru_cache,\s*cache\s*$/m);
    // The original maxsize=128 site stays untouched.
    expect(r.newContent).toContain('@lru_cache(maxsize=128)');
  });

  // Regression — see review finding C2. Previously, `collect_aliases` set
  // `has_bare_lru = True` regardless of any `as` rename, so the import
  // rewriter would replace `from functools import lru_cache as cache_dec`
  // with `from functools import cache as cache_dec`, breaking the surviving
  // bare `@cache` decorator (NameError at runtime).
  it('does NOT corrupt `lru_cache as cache_dec` imports when rewriting a co-existing bare site', async () => {
    // Two separate imports: one is the aliased form (which the rewriter
    // should leave alone), the other is the bare form that introduces the
    // `lru_cache` name the decorator below uses.
    const src = [
      'from functools import lru_cache as cache_dec',
      'from functools import lru_cache',
      '',
      '@lru_cache(maxsize=None)',
      'def f(x):',
      '    return x',
      '',
      '@cache_dec(maxsize=128)',
      'def g(x):',
      '    return x',
      '',
    ].join('\n');
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.11'),
    });
    expect(r.newContent).not.toBeNull();
    // The aliased import is left exactly as written — we don't touch
    // decorator sites that use `cache_dec`, so we MUST NOT rename the
    // import that defines that name (the pre-fix bug renamed it to
    // `from functools import cache as cache_dec`, which then collided
    // with the surviving bare `@cache` decorator below).
    expect(r.newContent).toMatch(/^from functools import lru_cache as cache_dec\s*$/m);
    // The bare-form import is augmented to also expose `cache` (the
    // conservative choice — the aliased import line still contains a
    // `Name("lru_cache")` reference so the counter sees lru_cache as
    // "still in use" and we keep the bare import while adding `cache`).
    // The result is internally consistent: bare `@cache` resolves, the
    // surviving `@cache_dec(maxsize=128)` resolves, and the aliased line
    // is untouched.
    expect(r.newContent).toMatch(/^from functools import lru_cache,\s*cache\s*$/m);
    // The aliased decorator survives untouched.
    expect(r.newContent).toContain('@cache_dec(maxsize=128)');
    // The new bare decorator is `@cache`.
    expect(r.newContent).toContain('@cache');
    // CRITICAL — the pre-fix bug would have produced this. Must never
    // appear: it rebinds the asname to a non-existent symbol.
    expect(r.newContent).not.toMatch(/from functools import cache as cache_dec/);
  });

  it('handles two separate `from functools import lru_cache` lines (counter sanity)', async () => {
    // Regression — see I2. The pre-fix counter assumed exactly one import
    // statement and would under-count surviving uses by one when there were
    // two such lines, potentially driving the wrong import-rewrite branch.
    const src = [
      'from functools import lru_cache',
      'from functools import lru_cache  # duplicate, legal Python',
      '',
      '@lru_cache(maxsize=None)',
      'def f(x):',
      '    return x',
      '',
      '@lru_cache(maxsize=128)',
      'def g(x):',
      '    return x',
      '',
    ].join('\n');
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.11'),
    });
    expect(r.newContent).not.toBeNull();
    // The surviving `@lru_cache(maxsize=128)` means lru_cache is still
    // needed; both import sites should remain importing lru_cache (and at
    // least one should be augmented with `cache`). We assert the survivor
    // and that some import line carries `cache`.
    expect(r.newContent).toContain('@lru_cache(maxsize=128)');
    expect(r.newContent).toContain('@cache');
    // The augmented line must be well-formed.
    expect(r.newContent).toMatch(/^from functools import lru_cache,\s*cache\s*$/m);
  });

  it('leaves @lru_cache() (no args) untouched', async () => {
    const src = 'from functools import lru_cache\n@lru_cache()\ndef f(x):\n    return x\n';
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.11'),
    });
    expect(r.newContent).toBeNull();
  });
});
