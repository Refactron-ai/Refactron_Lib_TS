// tests/unit/cli/verify-diff-wiring.test.ts
//
// `runVerifyDiffCommand` had NO test of any kind (issue #120). The pure
// formatters it calls were covered; the wiring that calls them was not, so both
// lines that print the test-scope note could be deleted and the suite stayed
// green. `testScope` became a VERDICT INPUT in #112, which makes an unasserted
// wiring path a way to silently drop the only evidence a stored report has that
// its verdict was scope-limited.
//
// `testScope` is decided by classifying the command STRING
// (src/verify/test-scope.ts), so these need no coverage.py. They DO need a green
// baseline, because `fuseVerdict` rewrites the scope to `unknown` when the tests
// gate saw no runner or an already-red baseline — `full`/`narrowed` would be a
// claim about a run that never happened. The two cases that assert a `narrowed`
// note therefore skip without pytest.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { runVerifyDiffCommand } from '../../../src/cli/verify-diff-command.js';

function hasPytest(): boolean {
  try {
    execSync('python3 -c "import pytest"', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
// These assert output that only appears once the tests gate observes a GREEN
// baseline, which needs a real runner. `it.skipIf`, never an early return: an
// early return reports PASSED and would hide the wiring going missing.
const NO_PYTEST = !hasPytest();

const savedEnv = { ...process.env };
let stdout = '';
let origOut: typeof process.stdout.write;
let origErr: typeof process.stderr.write;
const roots: string[] = [];

beforeEach(() => {
  stdout = '';
  origOut = process.stdout.write.bind(process.stdout);
  origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((s: string | Uint8Array) => {
    stdout += String(s);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  // The gate reads this; see tests/unit/cli/auth-gate.test.ts. Without it the
  // command exits 7 before reaching any of the output under test.
  process.env.REFACTRON_TOKEN = 'sk_test_xxxxxxxxxxxx';
});

afterEach(async () => {
  process.stdout.write = origOut;
  process.stderr.write = origErr;
  process.env = { ...savedEnv };
  for (const r of roots.splice(0)) await fs.rm(r, { recursive: true, force: true });
});

/** A repo whose baseline suite is GREEN, plus a valid unified diff against it.
 *
 *  The green baseline is load-bearing. `fuseVerdict` deliberately rewrites the
 *  recorded scope to `unknown` when the tests gate reports no runner or an
 *  already-red baseline, because `full`/`narrowed` would be a claim about a run
 *  that never happened. A fixture without a passing test therefore suppresses
 *  the very note these tests assert — which is correct engine behaviour and was
 *  how the first draft of this file failed. */
async function fixture(): Promise<{ root: string; diffPath: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-wiring-'));
  roots.push(root);
  await fs.writeFile(path.join(root, 'calc.py'), 'def scale(x):\n    return x * 2\n');
  await fs.mkdir(path.join(root, 'tests'), { recursive: true });
  await fs.writeFile(path.join(root, 'tests', 'test_a.py'), 'def test_a():\n    assert True\n');
  const diffPath = path.join(root, 'change.diff');
  await fs.writeFile(
    diffPath,
    [
      '--- a/calc.py',
      '+++ b/calc.py',
      '@@ -1,2 +1,2 @@',
      ' def scale(x):',
      '-    return x * 2',
      '+    return x * 3',
      '',
    ].join('\n'),
  );
  return { root, diffPath };
}

describe('runVerifyDiffCommand: test-scope note wiring (#120)', () => {
  it.skipIf(NO_PYTEST)(
    'prints the narrowed-scope note',
    async () => {
      const { root, diffPath } = await fixture();
      await runVerifyDiffCommand([
        root,
        '--diff',
        diffPath,
        '--test-cmd',
        'pytest tests/test_a.py',
      ]);
      // Key on text unique to the NOTE. "narrowed the suite" alone also appears
      // in the verdict REASON line, so asserting only that lets this pass with
      // the wiring deleted. Verified by re-running against a stripped command.
      expect(stdout).toContain('Re-run without the filter');
      expect(stdout).toContain('narrowed the suite');
      expect(stdout).toContain('tests/test_a.py');
      expect(stdout).toContain('cannot be SAFE');
    },
    120_000,
  );

  it('stays silent for a whole-suite command', async () => {
    const { root, diffPath } = await fixture();
    await runVerifyDiffCommand([root, '--diff', diffPath, '--test-cmd', 'python3 -m pytest -q']);
    expect(stdout).not.toContain('Re-run without the filter');
    expect(stdout).not.toContain('narrowed the suite');
  }, 120_000);

  it('discloses an unparsed command instead of letting it read as clean', async () => {
    const { root, diffPath } = await fixture();
    await runVerifyDiffCommand([root, '--diff', diffPath, '--test-cmd', 'make test']);
    expect(stdout).toContain('could not determine whether the test command runs the whole suite');
  }, 120_000);

  it.skipIf(NO_PYTEST)(
    'prints the scope note BEFORE the changed-test-files note',
    async () => {
      // The comment above the wiring claims the scope note "outranks the
      // advisories" because it explains the verdict. Ordering was documented and
      // unasserted, so a reorder would have been invisible.
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-wiring-order-'));
      roots.push(root);
      await fs.mkdir(path.join(root, 'tests'), { recursive: true });
      await fs.writeFile(path.join(root, 'tests', 'test_a.py'), 'def test_a():\n    assert True\n');
      const diffPath = path.join(root, 'change.diff');
      await fs.writeFile(
        diffPath,
        [
          '--- a/tests/test_a.py',
          '+++ b/tests/test_a.py',
          '@@ -1,2 +1,2 @@',
          ' def test_a():',
          '-    assert True',
          '+    assert 1 == 1',
          '',
        ].join('\n'),
      );
      await runVerifyDiffCommand([
        root,
        '--diff',
        diffPath,
        '--test-cmd',
        'pytest tests/test_a.py',
      ]);
      // Note-only marker, for the reason given in the first test.
      const scopeAt = stdout.indexOf('Re-run without the filter');
      const testFilesAt = stdout.indexOf('this diff modifies test files');
      expect(scopeAt).toBeGreaterThan(-1);
      expect(testFilesAt).toBeGreaterThan(-1);
      expect(scopeAt).toBeLessThan(testFilesAt);
    },
    120_000,
  );
});
