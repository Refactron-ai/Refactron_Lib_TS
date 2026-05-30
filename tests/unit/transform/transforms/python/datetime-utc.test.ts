import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { transform } from '../../../../../src/transform/transforms/python/datetime-utc.js';
import type { CrossFileContext } from '../../../../../src/transform/types.js';

async function file(source: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 't-dt-utc-'));
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

describe('datetime_utc_alias (python) — version gate', () => {
  it('refuses when pythonVersion is unknown (null)', async () => {
    const src = 'import datetime\nx = datetime.timezone.utc\n';
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

  it('refuses on Python 3.10', async () => {
    const src = 'import datetime\nx = datetime.timezone.utc\n';
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.10'),
    });
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((c) => c.id === 'python_version_too_low' && !c.satisfied)).toBe(
      true,
    );
  });
});

describe('datetime_utc_alias (python) — rewrites on Python >= 3.11', () => {
  it('rewrites `datetime.timezone.utc` to `datetime.UTC`', async () => {
    const src = 'import datetime\nx = datetime.timezone.utc\n';
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.11'),
    });
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('datetime.UTC');
    expect(r.newContent).not.toContain('datetime.timezone.utc');
  });

  it('rewrites `dt.timezone.utc` to `dt.UTC` after `import datetime as dt`', async () => {
    const src = 'import datetime as dt\nx = dt.timezone.utc\n';
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.12'),
    });
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('dt.UTC');
    expect(r.newContent).not.toContain('dt.timezone.utc');
    // The module alias itself stays.
    expect(r.newContent).toContain('import datetime as dt');
  });

  it('drops `timezone` from import when only `timezone.utc` was used', async () => {
    const src = ['from datetime import timezone, timedelta', 'x = timezone.utc', ''].join('\n');
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.11'),
    });
    expect(r.newContent).not.toBeNull();
    // Stronger than a substring: enforce the merged-import shape.
    expect(r.newContent).toMatch(/^from datetime import UTC,\s*timedelta\s*$/m);
    expect(r.newContent).toContain('x = UTC');
    // `timezone` must be gone from both the import and the body.
    expect(r.newContent).not.toContain('timezone');
  });

  it('keeps `timezone` in import when constructor is also used', async () => {
    const src = [
      'from datetime import timezone, timedelta',
      'x = timezone.utc',
      'y = timezone(timedelta(hours=5))',
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
    // The augmented import has UTC alongside the surviving timezone+timedelta.
    expect(r.newContent).toMatch(/^from datetime import UTC,\s*timezone,\s*timedelta\s*$/m);
    expect(r.newContent).toContain('x = UTC');
    // The constructor call survives untouched.
    expect(r.newContent).toContain('y = timezone(timedelta(hours=5))');
  });

  it('refuses `from datetime import timezone as tz` (aliased import unsupported)', async () => {
    const src = 'from datetime import timezone as tz\nx = tz.utc\n';
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.11'),
    });
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((c) => c.id === 'aliased_import_unsupported' && !c.satisfied)).toBe(
      true,
    );
  });

  it('is a no-op when there is no datetime usage', async () => {
    const src = 'x = 1\n';
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

  it('I2: preserves multi-line parenthesized import shape when dropping timezone', async () => {
    // I2 regression: the multi-line `from datetime import (\n    timezone,\n
    //     timedelta,\n)` form should rewrite to the equivalent multi-line
    // shape -- not collapse onto one line, and not strip the trailing comma
    // (since black/ruff re-add it on the next run -- see M4).
    const src = [
      'from datetime import (',
      '    timezone,',
      '    timedelta,',
      ')',
      'x = timezone.utc',
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
    // The rewritten import is the multi-line form, NOT a single-line
    // `from datetime import UTC, timedelta`.
    expect(r.newContent).toContain('from datetime import (');
    expect(r.newContent).toMatch(/^\s+UTC,\s*$/m);
    expect(r.newContent).toMatch(/^\s+timedelta,?\s*$/m);
    expect(r.newContent).not.toContain('timezone');
    expect(r.newContent).toContain('x = UTC');
  });

  it('M4: keeps the trailing comma on multi-line parenthesized imports', async () => {
    // The previous behavior unconditionally stripped the trailing comma on
    // the last alias, causing diff churn after `black`/`ruff format`. For the
    // parenthesized form we must preserve it.
    const src = [
      'from datetime import (',
      '    timezone,',
      '    timedelta,',
      ')',
      'x = timezone.utc',
      'y = timezone(timedelta(hours=5))',
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
    // Trailing comma on the last alias inside the parens is preserved.
    expect(r.newContent).toMatch(/timedelta,\s*\n\)/);
  });

  it('M4: still strips the trailing comma on single-line non-parenthesized imports', async () => {
    // Sanity: the single-line form should NOT keep a dangling trailing comma
    // (no parens around the names).
    const src = ['from datetime import timezone, timedelta', 'x = timezone.utc', ''].join('\n');
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.11'),
    });
    expect(r.newContent).not.toBeNull();
    // Last alias has no trailing comma on the single-line form.
    expect(r.newContent).toMatch(/^from datetime import UTC, timedelta\s*$/m);
  });

  it('I3: when bare and aliased forms coexist, reason explains both were skipped', async () => {
    const src = [
      'from datetime import timezone',
      'from datetime import timezone as tz',
      'x = tz.utc',
      'y = timezone.utc',
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
    expect(r.newContent).toBeNull();
    const aliased = r.preconditions.find((c) => c.id === 'aliased_import_unsupported');
    expect(aliased).toBeDefined();
    expect(aliased!.satisfied).toBe(false);
    // The reason explicitly mentions that the unaliased form was ALSO skipped.
    expect(aliased!.reason).toMatch(/unaliased/i);
    expect(aliased!.reason).toMatch(/consistent/i);
  });

  it('keeps `timezone` in import when a function parameter shadows it', async () => {
    // Parameter shadowing should NOT count as "import unused" -- the
    // top-level `timezone.utc` use still requires `from datetime import
    // timezone` to remain (the rewrite turns it into `UTC` but the
    // bookkeeping must treat the parameter `timezone` as a separate binding).
    // `_count_bare_timezone_references` walks ALL Name("timezone") use-sites
    // (outside imports), so a `def f(timezone): pass` is counted as a
    // reference -- pinning this with a test.
    const src = [
      'from datetime import timezone',
      'def f(timezone):',
      '    return timezone',
      'x = timezone.utc',
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
    // `timezone` must stay in the import because the parameter binding is
    // counted as a use of the name (conservative: keep the import alongside UTC).
    expect(r.newContent).toMatch(/^from datetime import UTC,\s*timezone\s*$/m);
    expect(r.newContent).toContain('x = UTC');
    // Function still references its parameter `timezone`.
    expect(r.newContent).toContain('def f(timezone):');
  });

  it('emits a precondition record when no datetime import is in scope (Bug #3)', async () => {
    const src = 'def f(x):\n    return x + 1\n';
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.11'),
    });
    expect(r.newContent).toBeNull();
    expect(
      r.preconditions.some(
        (c) => c.id === 'no_datetime_import_in_scope' && !c.satisfied,
      ),
    ).toBe(true);
  });
});
