import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { transform as pep604 } from '../../../../../src/transform/transforms/python/pep604-optional-union.js';
import { transform as pep585 } from '../../../../../src/transform/transforms/python/pep585-generics.js';
import type { CrossFileContext } from '../../../../../src/transform/types.js';

async function file(source: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 't-pep604-'));
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

describe('pep604_optional_union (python) — version gate', () => {
  it('refuses on Python 3.9 without __future__ annotations', async () => {
    const src = 'from typing import Optional\ndef f(x: Optional[int]) -> None: ...\n';
    const p = await file(src);
    const r = await pep604({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.9'),
    });
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((c) => c.id === 'python_version_too_low' && !c.satisfied)).toBe(
      true,
    );
  });

  it('refuses when pythonVersion is unknown (null)', async () => {
    const src = 'from typing import Optional\ndef f(x: Optional[int]) -> None: ...\n';
    const p = await file(src);
    const r = await pep604({
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

  it('allows on 3.9 when `from __future__ import annotations` is present', async () => {
    const src = [
      'from __future__ import annotations',
      'from typing import Optional',
      'def f(x: Optional[int]) -> None: ...',
      '',
    ].join('\n');
    const p = await file(src);
    const r = await pep604({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.9'),
    });
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('int | None');
  });
});

describe('pep604_optional_union (python) — rewrites on Python >= 3.10', () => {
  it('rewrites Optional[X] -> X | None', async () => {
    const src = 'from typing import Optional\ndef f(x: Optional[int]) -> None: ...\n';
    const p = await file(src);
    const r = await pep604({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.10'),
    });
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('int | None');
    expect(r.newContent).not.toContain('Optional[');
    expect(r.newContent).not.toMatch(/from typing import/);
  });

  it('rewrites Union[A, B, C] -> A | B | C', async () => {
    const src = 'from typing import Union\ndef f(x: Union[int, str, bytes]) -> None: ...\n';
    const p = await file(src);
    const r = await pep604({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.11'),
    });
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('int | str | bytes');
    expect(r.newContent).not.toContain('Union[');
  });

  it('unwraps Union[A] (single-arg edge case)', async () => {
    const src = 'from typing import Union\ndef f(x: Union[int]) -> None: ...\n';
    const p = await file(src);
    const r = await pep604({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.11'),
    });
    expect(r.newContent).not.toBeNull();
    // Union[int] collapses to just `int`.
    expect(r.newContent).toMatch(/x:\s*int\)/);
    expect(r.newContent).not.toContain('Union[');
  });

  it('Union[A, None] -> A | None', async () => {
    const src = 'from typing import Union\ndef f(x: Union[int, None]) -> None: ...\n';
    const p = await file(src);
    const r = await pep604({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.11'),
    });
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('int | None');
  });

  it('Optional[Optional[X]] collapses to X | None', async () => {
    const src = 'from typing import Optional\ndef f(x: Optional[Optional[int]]) -> None: ...\n';
    const p = await file(src);
    const r = await pep604({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.11'),
    });
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('int | None');
    // Must not double up None.
    expect(r.newContent).not.toContain('None | None');
  });

  it('Optional[Union[A, B]] collapses to A | B | None', async () => {
    const src =
      'from typing import Optional, Union\ndef f(x: Optional[Union[int, str]]) -> None: ...\n';
    const p = await file(src);
    const r = await pep604({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.11'),
    });
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('int | str | None');
    expect(r.newContent).not.toContain('Optional[');
    expect(r.newContent).not.toContain('Union[');
  });

  it('refuses Pydantic v1 files with runtime_type_eval_unsafe', async () => {
    const src = [
      'from pydantic import BaseModel',
      'from typing import Optional',
      'class M(BaseModel):',
      '    x: Optional[int]',
      '',
    ].join('\n');
    const p = await file(src);
    const r = await pep604({
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
});

describe('pep604_optional_union (python) — runtime-eval safety', () => {
  it('refuses aliased `get_type_hints` (C2 regression)', async () => {
    // `from typing import get_type_hints as gth` + a `gth(...)` call must
    // count as runtime annotation evaluation. The pre-fix detector only
    // matched the canonical name in imports and the `typing.get_type_hints`
    // attribute form, so this aliased usage slipped through.
    const src = [
      'from typing import get_type_hints as gth',
      'from typing import Optional',
      '',
      'class MyClass: ...',
      '',
      'def f(x: Optional[int]) -> None: ...',
      '',
      'hints = gth(MyClass)',
      '',
    ].join('\n');
    const p = await file(src);
    const r = await pep604({
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

  it('refuses runtime-subscript `isinstance(x, Union[int, str])` under __future__ on 3.9 (I2)', async () => {
    const src = [
      'from __future__ import annotations',
      'from typing import Union',
      'def f(x):',
      '    if isinstance(x, Union[int, str]):',
      '        return x',
      '',
    ].join('\n');
    const p = await file(src);
    const r = await pep604({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.9'),
    });
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((c) => c.id === 'runtime_subscript_unsafe' && !c.satisfied)).toBe(
      true,
    );
  });
});

describe('pep604_optional_union (python) — edge cases', () => {
  it('Union[None, A] -> A | None (None moved to end) (M2)', async () => {
    const src = 'from typing import Union\ndef f(x: Union[None, int]) -> None: ...\n';
    const p = await file(src);
    const r = await pep604({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.11'),
    });
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('int | None');
    // Make sure None was repositioned (not left in head).
    expect(r.newContent).not.toContain('None | int');
  });
});

describe('pep585 + pep604 composition', () => {
  it('Dict[str, Optional[int]] -> dict[str, int | None] when both fire', async () => {
    // First pep585 (rewrites Dict -> dict, leaves Optional alone), then
    // pep604 (rewrites Optional -> | None). The engine drives composition by
    // feeding pep585's newContent into pep604 as the next ctx.source.
    const src = [
      'from typing import Dict, Optional',
      'def f(x: Dict[str, Optional[int]]) -> None: ...',
      '',
    ].join('\n');
    const p = await file(src);

    const r585 = await pep585({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.11'),
    });
    expect(r585.newContent).not.toBeNull();
    const intermediate = r585.newContent!;
    expect(intermediate).toContain('dict[str, Optional[int]]');

    const r604 = await pep604({
      absPath: p,
      relPath: 'f.py',
      source: intermediate,
      findings: [],
      crossFile: cf('3.11'),
    });
    expect(r604.newContent).not.toBeNull();
    expect(r604.newContent).toContain('dict[str, int | None]');
    // Both typing imports gone now.
    expect(r604.newContent).not.toMatch(/from typing import/);
  });

  it('Optional[List[int]] -> list[int] | None (inverse topology, M3)', async () => {
    // Mirror of the test above with the generic on the OUTSIDE of Optional.
    // pep585 rewrites the inner List, leaving the Optional wrapper; pep604
    // then collapses to `list[int] | None`.
    const src = [
      'from typing import Optional, List',
      'def f(x: Optional[List[int]]) -> None: ...',
      '',
    ].join('\n');
    const p = await file(src);

    const r585 = await pep585({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.11'),
    });
    expect(r585.newContent).not.toBeNull();
    const intermediate = r585.newContent!;
    expect(intermediate).toContain('Optional[list[int]]');

    const r604 = await pep604({
      absPath: p,
      relPath: 'f.py',
      source: intermediate,
      findings: [],
      crossFile: cf('3.11'),
    });
    expect(r604.newContent).not.toBeNull();
    expect(r604.newContent).toContain('list[int] | None');
    expect(r604.newContent).not.toMatch(/from typing import/);
  });

  it('emits a precondition record when no Optional/Union import is in scope (Bug #3)', async () => {
    const src = 'def f(x: int) -> int:\n    return x + 1\n';
    const p = await file(src);
    const r = await pep604({
      absPath: p,
      relPath: 'f.py',
      source: src,
      findings: [],
      crossFile: cf('3.11'),
    });
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((c) => c.id === 'no_typing_import_in_scope' && !c.satisfied)).toBe(
      true,
    );
  });
});
