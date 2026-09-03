// tests/unit/verify/stability.test.ts
//
// The runStabilityCheck runner (#146). Spawns REAL test commands against tmp
// fixtures under varied PYTHONHASHSEED values, because the properties that matter
// (a red rerun is variance, a timeout is inconclusive not variance, a parse gap
// still floors, no runner is a skip) live in the interaction with real processes.
// Every classification error here is a false UNPROVEN or a dishonest report; none
// can be a false SAFE, but they are still below the bar.
import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { runStabilityCheck } from '../../../src/verify/stability.js';
import type { FileChange, TransformId } from '../../../src/contracts.js';

function hasPython(): boolean {
  try {
    execSync('python3 -c "import pytest"', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const NO_PYTHON = !hasPython();
// A rerun that spins to force a timeout orphans its python on Windows (Node does
// not tree-kill the grandchild), locking the temp dir. The inconclusive path is
// verified on POSIX; Windows tree-kill is the same tracked follow-up as ADR-15.
// A busy loop, not time.sleep: on Node 18 execa's timeout reliably kills a
// CPU-spinning child but was flaky killing a sleeping one (the mutation hang test
// uses the same loop form for the same reason).
const NO_HANG = NO_PYTHON || process.platform === 'win32';

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await fs.rm(r, { recursive: true, force: true });
});

async function repo(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stab-run-'));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
  return root;
}

// No content change: a stability rerun keeps the code fixed and only varies the
// conditions, so the changes list is inert here (an empty edit of an existing
// file). It exists so the runner builds a real shadow.
const noChange = (root: string, rel: string, content: string): FileChange[] => [
  {
    path: path.join(root, rel),
    oldHash: '',
    newContent: content,
    transformId: 'external-diff' as unknown as TransformId,
  },
];

describe('runStabilityCheck (#146)', () => {
  it.skipIf(NO_PYTHON)('flags a seed-dependent test as varied', async () => {
    // The test passes only when PYTHONHASHSEED is unset or 0; the reruns at seeds
    // 1 and 2 fail, so its outcome varies. This is the deterministic instance of
    // the flake class the check exists to catch.
    const calc = 'def scale(x):\n    return x * 2\n';
    const test =
      'import os\nfrom calc import scale\n\n\ndef test_scale():\n    scale(5)\n    assert os.environ.get("PYTHONHASHSEED") in (None, "0")\n';
    const root = await repo({ 'calc.py': calc, 'tests/test_scale.py': test });
    const r = await runStabilityCheck({
      repoRoot: root,
      changes: noChange(root, 'calc.py', calc),
      testCmd: 'python3 -m pytest -q',
      timeoutMs: 30_000,
      seeds: ['0', '1', '2'],
    });
    expect(r.ran).toBe(true);
    expect(r.varied.length).toBeGreaterThan(0);
    expect(r.inconclusive).toBe(0);
  });

  it.skipIf(NO_PYTHON)('a deterministic test never varies across seeds', async () => {
    const calc = 'def scale(x):\n    return x * 2\n';
    const test = 'from calc import scale\n\n\ndef test_scale():\n    assert scale(5) == 10\n';
    const root = await repo({ 'calc.py': calc, 'tests/test_scale.py': test });
    const r = await runStabilityCheck({
      repoRoot: root,
      changes: noChange(root, 'calc.py', calc),
      testCmd: 'python3 -m pytest -q',
      timeoutMs: 30_000,
      seeds: ['0', '1', '2'],
    });
    expect(r.ran).toBe(true);
    expect(r.varied).toEqual([]);
    expect(r.runs).toBe(3);
  });

  it.skipIf(NO_HANG)('a rerun that times out is inconclusive, never variance', async () => {
    // Under a non-zero seed the test spins and the rerun times out. A timeout is
    // inconclusive: it must not be counted as a varied (red) outcome, or a slow
    // suite would manufacture a false UNPROVEN.
    const calc = 'def scale(x):\n    return x * 2\n';
    const test =
      'import os\nfrom calc import scale\n\n\ndef test_scale():\n    scale(5)\n    if os.environ.get("PYTHONHASHSEED") not in (None, "0"):\n        while True:\n            pass\n    assert True\n';
    const root = await repo({ 'calc.py': calc, 'tests/test_scale.py': test });
    const r = await runStabilityCheck({
      repoRoot: root,
      changes: noChange(root, 'calc.py', calc),
      testCmd: 'python3 -m pytest -q',
      timeoutMs: 3_000,
      seeds: ['0', '1', '2'],
    });
    expect(r.varied).toEqual([]);
    expect(r.inconclusive).toBeGreaterThan(0);
  });

  it.skipIf(NO_PYTHON)('skips when there is no runner to rerun', async () => {
    const calc = 'def scale(x):\n    return x * 2\n';
    const root = await repo({ 'calc.py': calc });
    // No testCmd and no runner config in the dir → detectRunner returns null.
    const r = await runStabilityCheck({
      repoRoot: root,
      changes: noChange(root, 'calc.py', calc),
      seeds: ['0', '1'],
    });
    expect(r.ran).toBe(false);
    expect(r.skippedReason).toMatch(/no test runner/i);
    expect(r.varied).toEqual([]);
  });
});
