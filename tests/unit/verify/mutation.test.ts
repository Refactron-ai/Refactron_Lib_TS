// tests/unit/verify/mutation.test.ts
//
// The runMutation runner (ADR-15). Spawns the REAL mutate.py sidecar and REAL
// test commands against tmp fixtures — never mocked, because the properties that
// matter (a hang is inconclusive not a survivor, a red baseline is skipped, the
// budget truncates, the span guard fails safe) live in the interaction with
// those processes. Every classification error here is a false UNPROVEN or a
// dishonest report; none can be a false SAFE, but they are still below the bar.
import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { runMutation, applyMutant } from '../../../src/verify/mutation.js';
import type { ChangedRange } from '../../../src/verify/diff-input.js';

function hasPython(): boolean {
  try {
    execSync('python3 -c ""', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const NO_PYTHON = !hasPython();
// A deliberately-hung mutant orphans its process on Windows (execa times out the
// shell but Node does not tree-kill the grandchild), which locks the temp dir.
// The timeout->inconclusive path is verified on POSIX; Windows tree-kill is a
// tracked follow-up. See ADR-15 known limitations.
const NO_HANG = NO_PYTHON || process.platform === 'win32';

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await fs.rm(r, { recursive: true, force: true });
});

async function repo(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mut-run-'));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    await fs.writeFile(path.join(root, rel), content);
  }
  return root;
}
const ranges = (...rs: ChangedRange[]): ChangedRange[] => rs;

describe('runMutation (ADR-15)', () => {
  it('applyMutant returns null when the span does not match the source (fail-safe guard)', () => {
    // Pure guard test, no python. If this ever returned a mutated string on a
    // mismatch, it would mutate a file the numbers do not describe → bogus
    // survivor → false UNPROVEN.
    const line = 'x = a + b';
    const good = { line: 1, col: 6, endCol: 7, orig: '+', repl: '-', op: '+->-' };
    expect(applyMutant(line, good)).toBe('x = a - b');
    const mismatch = { ...good, orig: '*' }; // source at [6,7) is '+', not '*'
    expect(applyMutant(line, mismatch)).toBeNull();
    const oob = { line: 99, col: 0, endCol: 1, orig: '+', repl: '-', op: '+->-' };
    expect(applyMutant(line, oob)).toBeNull();
  });

  it.skipIf(NO_PYTHON)('records a survivor a weak test does not catch', async () => {
    const root = await repo({ 'calc.py': 'def f(n):\n    return n + 1\n' });
    const r = await runMutation({
      shadowRoot: root,
      ranges: ranges({ path: 'calc.py', lines: [2] }),
      testCmd: 'python3 -c "import calc; assert isinstance(calc.f(2), int)"',
      timeoutMs: 30_000,
    });
    expect(r.ran).toBe(true);
    expect(r.survivors).toEqual([{ file: 'calc.py', line: 2, operator: '+', mutatedTo: '-' }]);
    expect(r.killed).toBe(0);
  });

  it.skipIf(NO_PYTHON)('classifies a mutant a strong test catches as killed', async () => {
    const root = await repo({ 'calc.py': 'def f(n):\n    return n + 1\n' });
    const r = await runMutation({
      shadowRoot: root,
      ranges: ranges({ path: 'calc.py', lines: [2] }),
      testCmd: 'python3 -c "import calc; assert calc.f(2) == 3"',
      timeoutMs: 30_000,
    });
    expect(r.survivors).toEqual([]);
    expect(r.killed).toBe(1);
  });

  it.skipIf(NO_HANG)('classifies a hanging mutant as inconclusive, never a survivor', async () => {
    // `-`->`+` makes the loop never terminate; the run times out. Timeout must be
    // inconclusive (skipped), not a survivor. The check order in the runner
    // (timedOut before exitCode) is what this pins.
    const root = await repo({
      'calc.py': 'def f(n):\n    while n > 0:\n        n = n - 1\n    return n\n',
    });
    const r = await runMutation({
      shadowRoot: root,
      ranges: ranges({ path: 'calc.py', lines: [3] }),
      testCmd: 'python3 -c "import calc; assert calc.f(3) == 0"',
      timeoutMs: 3_000,
    });
    expect(r.survivors).toEqual([]);
    expect(r.inconclusive).toBe(1);
  });

  it.skipIf(NO_PYTHON)('skips mutation when the baseline is not green', async () => {
    const root = await repo({ 'calc.py': 'def f(n):\n    return n + 1\n' });
    const r = await runMutation({
      shadowRoot: root,
      ranges: ranges({ path: 'calc.py', lines: [2] }),
      testCmd: 'python3 -c "assert False"',
      timeoutMs: 30_000,
    });
    expect(r.survivors).toEqual([]);
    expect(r.skippedReason).toMatch(/baseline/i);
  });

  it.skipIf(NO_PYTHON)(
    'truncates at the budget and still catches a within-budget survivor',
    async () => {
      const root = await repo({
        'calc.py': 'def f(a, b):\n    x = a + b\n    y = a - b\n    return x\n',
      });
      const r = await runMutation({
        shadowRoot: root,
        ranges: ranges({ path: 'calc.py', lines: [2, 3] }),
        testCmd: 'python3 -c "import calc; calc.f(2, 3)"', // always passes → every mutant survives
        timeoutMs: 30_000,
        budget: 1,
      });
      expect(r.tested).toBe(1);
      expect(r.truncated).toEqual({ tested: 1, total: 2 });
      expect(r.survivors.length).toBe(1);
    },
  );

  it.skipIf(NO_PYTHON)('skips when there is no runner to mutate against', async () => {
    const root = await repo({ 'calc.py': 'def f(n):\n    return n + 1\n' });
    // No testCmd and no runner config in the dir → detectRunner returns null.
    const r = await runMutation({
      shadowRoot: root,
      ranges: ranges({ path: 'calc.py', lines: [2] }),
    });
    expect(r.ran).toBe(false);
    expect(r.skippedReason).toMatch(/no test runner/i);
    expect(r.survivors).toEqual([]);
  });

  it.skipIf(NO_PYTHON)('restores every mutated file after the run', async () => {
    const original = 'def f(n):\n    return n + 1\n';
    const root = await repo({ 'calc.py': original });
    await runMutation({
      shadowRoot: root,
      ranges: ranges({ path: 'calc.py', lines: [2] }),
      testCmd: 'python3 -c "import calc; calc.f(2)"',
      timeoutMs: 30_000,
    });
    expect(await fs.readFile(path.join(root, 'calc.py'), 'utf8')).toBe(original);
  });
});
