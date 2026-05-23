import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { transform } from '../../../../../src/transform/transforms/python/pep585-generics.js';
import type { CrossFileContext } from '../../../../../src/transform/types.js';

async function file(source: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 't-pep585-'));
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

describe('pep585_generics (python) — version gate', () => {
  it('refuses on Python 3.8 without __future__ annotations', async () => {
    const src = 'from typing import List\ndef f(x: List[int]) -> None: ...\n';
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

  it('refuses when pythonVersion is unknown (null)', async () => {
    const src = 'from typing import List\ndef f(x: List[int]) -> None: ...\n';
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

  it('allows on 3.8 when `from __future__ import annotations` is present', async () => {
    const src = [
      'from __future__ import annotations',
      'from typing import List',
      'def f(x: List[int]) -> None: ...',
      '',
    ].join('\n');
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.8'),
    });
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('list[int]');
  });
});

describe('pep585_generics (python) — rewrites on Python >= 3.9', () => {
  it('rewrites typing.List[int] -> list[int]', async () => {
    const src = 'import typing\ndef f(x: typing.List[int]) -> None: ...\n';
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.9'),
    });
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('list[int]');
    expect(r.newContent).not.toContain('typing.List[int]');
  });

  it('rewrites bare List/Dict/Tuple and drops the typing import when fully unused', async () => {
    const src = [
      'from typing import List, Dict, Tuple',
      'def f(a: List[int], b: Dict[str, int], c: Tuple[int, ...]) -> None: ...',
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
    expect(r.newContent).toContain('list[int]');
    expect(r.newContent).toContain('dict[str, int]');
    expect(r.newContent).toContain('tuple[int, ...]');
    // The typing import line should be gone entirely.
    expect(r.newContent).not.toMatch(/from typing import/);
  });

  it('partial drop: only converted names removed from `from typing import ...`', async () => {
    // List is converted; Optional is left for pep604 — the import line must
    // keep Optional after pruning List.
    const src = [
      'from typing import List, Optional',
      'def f(a: List[int], b: Optional[int]) -> None: ...',
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
    expect(r.newContent).toContain('list[int]');
    // Optional must survive untouched (pep604's job, not ours).
    expect(r.newContent).toContain('Optional[int]');
    expect(r.newContent).toMatch(/from typing import\s+Optional/);
    expect(r.newContent).not.toMatch(/from typing import\s+List/);
  });

  it('adds `from collections.abc import ...` for Mapping / Sequence', async () => {
    const src = [
      'from typing import Mapping, Sequence',
      'def f(a: Mapping[str, int], b: Sequence[int]) -> None: ...',
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
    expect(r.newContent).toMatch(/from collections\.abc import .*Mapping/);
    expect(r.newContent).toMatch(/from collections\.abc import .*Sequence/);
    expect(r.newContent).not.toMatch(/from typing import/);
  });

  it('rewrites typing.Pattern -> re.Pattern and adds `from re import Pattern`', async () => {
    const src = ['import typing', 'def f(p: typing.Pattern[str]) -> None: ...', ''].join('\n');
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.11'),
    });
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('Pattern[str]');
    // Either `from re import Pattern` was added, or the attribute form is used.
    expect(r.newContent).toMatch(/from re import .*Pattern/);
  });

  it('refuses Pydantic v1 files with runtime_type_eval_unsafe', async () => {
    const src = [
      'from pydantic import BaseModel',
      'from typing import List',
      'class M(BaseModel):',
      '    xs: List[int]',
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
    expect(r.preconditions.some((c) => c.id === 'runtime_type_eval_unsafe' && !c.satisfied)).toBe(
      true,
    );
  });

  it('preserves the module docstring when adding a new import (C1 regression)', async () => {
    // Regression for C1: the import-insertion loop used to break at the
    // docstring (an Expr(SimpleString)) and prepend the new import at index
    // 0, silently destroying `__doc__`. After the fix the docstring must
    // remain the first statement and the new `from collections.abc import
    // Mapping` line must land below it.
    const src = [
      '"""Module docstring."""',
      '',
      'from typing import Mapping',
      '',
      'def f(x: Mapping[str, int]) -> None: ...',
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
    // Docstring is preserved as the very first thing in the file.
    expect(r.newContent!.startsWith('"""Module docstring."""')).toBe(true);
    // And the new abc import is below it (not before it).
    const docIdx = r.newContent!.indexOf('"""Module docstring."""');
    const abcIdx = r.newContent!.indexOf('from collections.abc import');
    expect(abcIdx).toBeGreaterThan(docIdx);
    // ABC `Mapping` stays capitalized — the rewrite reroutes the import
    // source (collections.abc), it doesn't lowercase the name.
    expect(r.newContent).toContain('Mapping[str, int]');
  });

  it('preserves the docstring when adding `import collections` (C1 regression)', async () => {
    // Same defect, second site: `_ensure_collections_module_import` had the
    // identical loop. Trigger it via a Counter rewrite (collections-module
    // target).
    const src = [
      '"""Module docstring."""',
      '',
      'from typing import Counter',
      '',
      'def f(x: Counter[str]) -> None: ...',
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
    expect(r.newContent!.startsWith('"""Module docstring."""')).toBe(true);
    const docIdx = r.newContent!.indexOf('"""Module docstring."""');
    const importIdx = r.newContent!.indexOf('import collections');
    expect(importIdx).toBeGreaterThan(docIdx);
  });

  it('refuses runtime-subscript `isinstance(x, List[int])` under __future__ on Python 3.8 (I2)', async () => {
    // Without the guard, the `from __future__ import annotations` override
    // would let the rewrite go through on 3.8, producing
    // `isinstance(x, list[int])` which TypeErrors at runtime.
    const src = [
      'from __future__ import annotations',
      'from typing import List',
      'def f(x):',
      '    if isinstance(x, List[int]):',
      '        return x',
      '',
    ].join('\n');
    const p = await file(src);
    const r = await transform({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.8'),
    });
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((c) => c.id === 'runtime_subscript_unsafe' && !c.satisfied)).toBe(
      true,
    );
  });

  it('keeps `from typing import List as L` verbatim when starred-rewrite cleans up (I1 regression)', async () => {
    // Genuine renames must survive the pruning pass. Trigger the cleanup via
    // a `from typing import *` import (which adds every TARGETS name to the
    // rewrite-eligible set) plus a `from typing import List as L` rename that
    // we must NOT touch.
    const src = [
      'from typing import *',
      'from typing import List as L',
      'def f(a: Mapping[str, int], b: L[int]) -> None: ...',
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
    // The rename is preserved verbatim.
    expect(r.newContent).toMatch(/from typing import List as L/);
    // And the L[...] site is left alone (we only rewrite the bare canonical).
    expect(r.newContent).toContain('L[int]');
  });

  it('does NOT touch Optional/Union (pep604 owns those)', async () => {
    const src = [
      'from typing import Optional, Union',
      'def f(a: Optional[int], b: Union[int, str]) -> None: ...',
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
    // No subscripts rewritten -> no change.
    expect(r.newContent).toBeNull();
  });
});
