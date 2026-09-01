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

  it.skipIf(NO_PYTHON)('never mutates inside a string or a comment', () => {
    // The `<=` and `+` here live in a string and a comment; tokenize classifies
    // them as STRING/COMMENT, so no mutant may target them.
    const src = 'x = "a <= b"  # and a + comment\ny = 1\n';
    expect(mutate(src, [1])).toEqual([]);
  });

  it.skipIf(NO_PYTHON)('ignores operators on unchanged lines', () => {
    const src = 'a = 1 + 2\nb = 3 + 4\n';
    const ops = mutate(src, [2]);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.line).toBe(2);
  });

  it.skipIf(NO_PYTHON)('does not treat ** or += as mutable * or +', () => {
    const src = 'x = 2 ** 3\ny = 0\ny += 1\n';
    expect(mutate(src, [1, 3])).toEqual([]);
  });
});
