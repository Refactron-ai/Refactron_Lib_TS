import { describe, it, expect } from 'vitest';
import { parsePython } from '../../../../../src/analyze/parser.js';
import { detect } from '../../../../../src/analyze/detectors/python/typing-generic.js';

const ctx = (s: string) => ({
  absPath: '/x/a.py',
  relPath: 'a.py',
  source: s,
  tree: parsePython(s),
});

describe('python: typing-generic (PEP 585) detector', () => {
  it('detects typing.List[str] via `import typing`', () => {
    const src = 'import typing\ndef f(x: typing.List[str]) -> None: ...\n';
    const f = detect(ctx(src));
    expect(f).toHaveLength(1);
    expect(f[0]!.transformId).toBe('pep585_generics');
    expect(f[0]!.confidence).toBe('high');
  });

  it('detects bare List[str] after `from typing import List`', () => {
    const src = 'from typing import List\ndef f(x: List[str]) -> None: ...\n';
    expect(detect(ctx(src))).toHaveLength(1);
  });

  it('detects each of Dict, Tuple, Set, FrozenSet, Type', () => {
    const src = [
      'from typing import Dict, Tuple, Set, FrozenSet, Type',
      'def f(',
      '    a: Dict[str, int],',
      '    b: Tuple[int, ...],',
      '    c: Set[int],',
      '    d: FrozenSet[int],',
      '    e: Type[object],',
      ') -> None: ...',
      '',
    ].join('\n');
    expect(detect(ctx(src))).toHaveLength(5);
  });

  it('detects collections.abc equivalents (Mapping / Sequence / Callable)', () => {
    const src = [
      'from typing import Mapping, Sequence, Callable',
      'def f(',
      '    a: Mapping[str, int],',
      '    b: Sequence[int],',
      '    c: Callable[[int], int],',
      ') -> None: ...',
      '',
    ].join('\n');
    expect(detect(ctx(src))).toHaveLength(3);
  });

  it('detects re.Pattern / re.Match via typing.Pattern / typing.Match', () => {
    const src = [
      'import typing',
      'def f(p: typing.Pattern[str], m: typing.Match[str]) -> None: ...',
      '',
    ].join('\n');
    expect(detect(ctx(src))).toHaveLength(2);
  });

  it('does NOT detect Optional or Union (pep604 owns those)', () => {
    const src = [
      'from typing import Optional, Union',
      'def f(a: Optional[int], b: Union[int, str]) -> None: ...',
      '',
    ].join('\n');
    expect(detect(ctx(src))).toHaveLength(0);
  });

  it('skips aliased imports like `from typing import List as L`', () => {
    const src = 'from typing import List as L\ndef f(x: L[str]) -> None: ...\n';
    expect(detect(ctx(src))).toHaveLength(0);
  });

  it('skips bare List without a `from typing import List`', () => {
    const src = 'def f(x: List[str]) -> None: ...\n';
    expect(detect(ctx(src))).toHaveLength(0);
  });

  it('respects `from typing import *` (wildcards bind all targets)', () => {
    const src = 'from typing import *\ndef f(x: List[str]) -> None: ...\n';
    expect(detect(ctx(src))).toHaveLength(1);
  });

  it('handles `import typing as t` (module alias)', () => {
    const src = 'import typing as t\ndef f(x: t.List[str]) -> None: ...\n';
    expect(detect(ctx(src))).toHaveLength(1);
  });
});
