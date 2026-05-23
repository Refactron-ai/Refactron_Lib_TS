import { describe, it, expect } from 'vitest';
import { parsePython } from '../../../../../src/analyze/parser.js';
import { detect } from '../../../../../src/analyze/detectors/python/typing-optional-union.js';

const ctx = (s: string) => ({
  absPath: '/x/a.py',
  relPath: 'a.py',
  source: s,
  tree: parsePython(s),
});

describe('python: typing-optional-union (PEP 604) detector', () => {
  it('detects typing.Optional[int] via `import typing`', () => {
    const src = 'import typing\ndef f(x: typing.Optional[int]) -> None: ...\n';
    const f = detect(ctx(src));
    expect(f).toHaveLength(1);
    expect(f[0]!.transformId).toBe('pep604_optional_union');
    expect(f[0]!.confidence).toBe('high');
  });

  it('detects bare Optional[int] after `from typing import Optional`', () => {
    const src = 'from typing import Optional\ndef f(x: Optional[int]) -> None: ...\n';
    expect(detect(ctx(src))).toHaveLength(1);
  });

  it('detects Union[int, str]', () => {
    const src = 'from typing import Union\ndef f(x: Union[int, str]) -> None: ...\n';
    expect(detect(ctx(src))).toHaveLength(1);
  });

  it('detects nested Optional[Union[A, B]] (each layer counted)', () => {
    const src = [
      'from typing import Optional, Union',
      'def f(x: Optional[Union[int, str]]) -> None: ...',
      '',
    ].join('\n');
    // Two subscripts: outer Optional and inner Union.
    expect(detect(ctx(src))).toHaveLength(2);
  });

  it('skips List / Dict (pep585 owns those)', () => {
    const src = [
      'from typing import List, Dict',
      'def f(a: List[int], b: Dict[str, int]) -> None: ...',
      '',
    ].join('\n');
    expect(detect(ctx(src))).toHaveLength(0);
  });

  it('skips aliased imports `from typing import Optional as Opt`', () => {
    const src = 'from typing import Optional as Opt\ndef f(x: Opt[int]) -> None: ...\n';
    expect(detect(ctx(src))).toHaveLength(0);
  });

  it('handles `import typing as t`', () => {
    const src = 'import typing as t\ndef f(x: t.Optional[int]) -> None: ...\n';
    expect(detect(ctx(src))).toHaveLength(1);
  });
});
