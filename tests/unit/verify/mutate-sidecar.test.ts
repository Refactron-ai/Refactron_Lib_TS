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

function mutate(source: string, changedLines: number[]): Array<{ line: number; op: string }> {
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
    expect(ops).not.toContain('*->/');
    expect(ops).not.toContain('+->-');
  });

  it.skipIf(NO_PYTHON)(
    'emits a constant mutant for a number, string, and True/False/None (#149)',
    () => {
      const src = 'a = 5\nb = "hi"\nc = True\nd = None\ne = 0\n';
      const ms = mutate(src, [1, 2, 3, 4, 5]);
      const op = (ln: number) => ms.find((m) => m.line === ln)?.op;
      expect(op(1)).toBe('5->0');
      expect(op(2)).toBe('"hi"->""');
      expect(op(3)).toBe('True->False');
      expect(op(4)).toBe('None->True');
      expect(op(5)).toBe('0->1'); // a zero-valued literal maps to 1, never to 0
      for (const m of ms) expect(m.repl).not.toBe(m.orig); // never a no-op mutant
    },
  );

  it.skipIf(NO_PYTHON)('never mutates a docstring or a bare string statement (#149)', () => {
    // A module docstring, a function docstring, and a bare string statement are
    // all standalone expression statements: behaviour-inert, so mutating them
    // would manufacture a survivor no test could ever kill (a false UNPROVEN).
    const src = '"module doc"\n\n\ndef f():\n    "func doc"\n    "bare"\n    return 1\n';
    const ms = mutate(src, [1, 5, 6, 7]);
    expect(ms.map((m) => m.line)).toEqual([7]); // only the `1` value on line 7
    expect(ms[0]!.op).toBe('1->0');
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
