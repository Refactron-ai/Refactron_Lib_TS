// tests/unit/verify/mutate-sidecar.test.ts
//
// The mutate.py sidecar (ADR-15) generates operator mutants for the changed
// lines of a file. Tokenize-based, so string and comment contents are never
// mutated — a mutant inside a string would be a false survivor, i.e. a false
// UNPROVEN.
import { describe, it, expect } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const SIDECAR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../src/verify/checks/_py/mutate.py',
);

function hasPython(): boolean {
  try {
    execSync('python3 -c ""', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const NO_PYTHON = !hasPython();

interface SidecarMutant {
  line: number;
  col: number;
  endCol: number;
  orig: string;
  repl: string;
  op: string;
  kind: string;
}
function mutate(source: string, changedLines: number[]): SidecarMutant[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-side-'));
  const file = path.join(dir, 'm.py');
  fs.writeFileSync(file, source);
  try {
    const out = execFileSync('python3', [SIDECAR], {
      input: JSON.stringify({ path: file, changed_lines: changedLines }),
      encoding: 'utf8',
    });
    return JSON.parse(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('mutate.py sidecar (#116)', () => {
  it.skipIf(NO_PYTHON)('emits operator mutants only for changed lines', () => {
    const src = 'def f(n):\n    if n <= 10 and n > 0:\n        return n + 1\n    return n\n';
    const ops = mutate(src, [2, 3]).map((m) => m.op);
    expect(ops).toContain('<=-><');
    expect(ops).toContain('and->or');
    expect(ops).toContain('>->>=');
    expect(ops).toContain('+->-');
  });

  it.skipIf(NO_PYTHON)('mutates a string value but never its contents or a comment (#149)', () => {
    // The `<=` lives inside the string and `and`/`+` inside the comment; tokenize
    // keeps those as STRING/COMMENT tokens, so no mutant targets them. The string
    // used as a VALUE is a legitimate whole-token target (#149).
    const src = 'x = "a <= b"  # and a + comment\ny = 1\n';
    const ms = mutate(src, [1]);
    expect(ms).toHaveLength(1);
    expect(ms[0]!.orig).toBe('"a <= b"');
    expect(ms[0]!.op).toBe('"a <= b"->""');
    const ops = ms.map((m) => m.op);
    expect(ops).not.toContain('<=-><');
    expect(ops).not.toContain('+->-');
    expect(ops).not.toContain('and->or');
  });

  it.skipIf(NO_PYTHON)('ignores tokens on unchanged lines', () => {
    // Line 2 now yields several mutants (the `+` and both constants); the point
    // is that none of line 1's tokens are touched.
    const src = 'a = 1 + 2\nb = 3 + 4\n';
    const ms = mutate(src, [2]);
    expect(ms.length).toBeGreaterThan(0);
    expect(ms.every((m) => m.line === 2)).toBe(true);
  });

  it.skipIf(NO_PYTHON)('does not treat ** or += as a mutable * or +', () => {
    // The constants on these lines mutate now, but neither compound operator is
    // split into a mutable `*` or `+`.
    const src = 'x = 2 ** 3\ny = 0\ny += 1\n';
    const ops = mutate(src, [1, 3]).map((m) => m.op);
    // The exact set: only the constants mutate; neither compound operator is
    // split into a mutable `*` or `+`. Asserting the full set (not just absence)
    // also fails on any unexpected extra mutant.
    expect(ops).toEqual(['2->0', '3->0', '1->0']);
  });

  it.skipIf(NO_PYTHON)(
    'emits a constant mutant for a number, string, and True/False/None (#149)',
    () => {
      // Includes the two sub-rules the replacement helpers document: an
      // already-empty string maps to a sentinel (never a no-op `""->""`), and
      // every zero-valued literal maps to 1 (int and float alike), never to 0.
      const src = 'a = 5\nb = "hi"\nc = True\nd = None\ne = 0\nf = ""\ng = 0.0\nh = False\n';
      const ms = mutate(src, [1, 2, 3, 4, 5, 6, 7, 8]);
      const op = (ln: number) => ms.find((m) => m.line === ln)?.op;
      expect(op(1)).toBe('5->0');
      expect(op(2)).toBe('"hi"->""');
      expect(op(3)).toBe('True->False');
      expect(op(4)).toBe('None->True');
      expect(op(5)).toBe('0->1');
      expect(op(6)).toBe('""->"__mut__"');
      expect(op(7)).toBe('0.0->1');
      expect(op(8)).toBe('False->True');
      for (const m of ms) expect(m.repl).not.toBe(m.orig); // never a no-op mutant
      for (const m of ms) expect(m.kind).toBe('constant');
    },
  );

  it.skipIf(NO_PYTHON)('never mutates a docstring or a bare literal statement (#149)', () => {
    // Docstrings and bare literal statements (a bare string, number, or bool) are
    // all behaviour-inert, so mutating them manufactures a survivor no test could
    // ever kill (a false UNPROVEN). NUMBER and bool are guarded too, not only
    // strings, so a "docstrings are strings" simplification cannot silently
    // regress them.
    const src =
      '"module doc"\n\n\ndef f():\n    "func doc"\n    "bare"\n    42\n    True\n    return 1\n';
    const ms = mutate(src, [1, 5, 6, 7, 8, 9]);
    expect(ms.map((m) => m.line)).toEqual([9]); // only the `1` value on line 9
    expect(ms[0]!.op).toBe('1->0');
  });

  it.skipIf(NO_PYTHON)('never mutates an inline or implicit-concatenated docstring (#149)', () => {
    // The two docstring shapes a line-start heuristic misses: `_is_bare_stmt` sees
    // the `:` (inline) or the neighbouring STRING (concat) as non-bare, so these
    // are excluded by the AST docstring span instead. Both manufacture a false
    // UNPROVEN if mutated.
    expect(mutate('def f(): "doc"\n', [1])).toEqual([]);
    expect(mutate('"a" "b"\n', [1])).toEqual([]);
    expect(mutate('def g():\n    "x" "y"\n    return 1\n', [2])).toEqual([]);
  });

  it.skipIf(NO_PYTHON)('returns [] for un-tokenizable source instead of crashing', () => {
    // The refusal path: a source with a lexical error yields no mutants rather
    // than a non-zero exit or a stack trace. Mutation is opt-in evidence; its
    // absence must never grant SAFE, so producing nothing is the safe outcome.
    const src = 'def f(:\n    return 1 + 2\n'; // syntactically broken
    expect(mutate(src, [1, 2])).toEqual([]);
  });

  it.skipIf(NO_PYTHON)(
    'emits a star-in-unpacking mutant (fail-safe: it can only be killed)',
    () => {
      // Known imprecision: tokenize cannot tell `*args` unpacking from `*`
      // multiply, so `def f(*a)` yields a `*->/` mutant. Pinned as a fail-safe
      // wart: `def f(/a)` is a SyntaxError, so the mutant can only be classified
      // killed or over-block — never a survivor, never a false SAFE.
      const ops = mutate('def f(*a):\n    return a\n', [1]).map((m) => m.op);
      expect(ops).toContain('*->/');
    },
  );
});
