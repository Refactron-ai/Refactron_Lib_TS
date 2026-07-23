import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyDiff } from '../../src/verify/verify-diff.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '../fixtures/verify-diff-mini');
const TEST_CMD = 'python3 -m pytest -q';

function pythonHasCoverage(): boolean {
  try {
    execSync('python3 -c "import coverage, pytest"', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// A pytest project with one deterministically flaky test plus a source file the
// diff edits harmlessly. The flake is CROSS-TREE: its marker lives in the system
// temp dir (persists across shadow trees), so the gate's fresh-shadow retry
// heals it — the signature of a real timing flake, not tree-state leakage. It is
// ARMED only when it sees the CHANGED lib.py (the "# reordered" token), so the
// unmodified baseline tree runs it green and never consumes the marker. The
// marker is salted per run (env-injected) and removed in a finally, so reruns of
// our own suite stay deterministic. Exercises verifyDiff end to end.
async function flakyFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-flaky-'));
  await fs.writeFile(
    path.join(root, 'pyproject.toml'),
    '[tool.pytest.ini_options]\ntestpaths = ["."]\npythonpath = ["."]\n',
  );
  await fs.writeFile(path.join(root, 'lib.py'), 'def add(a, b):\n    return a + b\n');
  await fs.writeFile(
    path.join(root, 'test_flaky.py'),
    [
      'import os',
      'import tempfile',
      '',
      'def test_flaky():',
      '    with open(os.path.join(os.getcwd(), "lib.py")) as f:',
      '        src = f.read()',
      '    if "# reordered" not in src:',
      '        return  # baseline (unmodified) tree: unarmed, always green',
      '    marker = os.path.join(tempfile.gettempdir(), os.environ["REFACTRON_FLAKE_SALT"])',
      '    if not os.path.exists(marker):',
      '        open(marker, "w").close()',
      '        raise AssertionError("flaky: first run of the changed tree fails")',
      '    assert True',
      '',
    ].join('\n'),
  );
  return root;
}

describe('verifyDiff (python three-way, real coverage)', () => {
  it('semantics-preserving edit to COVERED code → SAFE', async () => {
    if (!pythonHasCoverage()) return;
    const report = await verifyDiff({
      repoRoot: FIXTURE,
      edits: [
        {
          path: 'calc.py',
          newContent:
            'def add(a, b):\n    return b + a\n\n\ndef unused_helper(a, b):\n    return a - b\n',
        },
      ],
      testCmd: TEST_CMD,
    });
    expect(report.verdict).toBe('SAFE');
  }, 180_000);

  it('behavior-breaking edit to COVERED code → UNSAFE', async () => {
    if (!pythonHasCoverage()) return;
    const report = await verifyDiff({
      repoRoot: FIXTURE,
      edits: [
        {
          path: 'calc.py',
          newContent:
            'def add(a, b):\n    return a - b\n\n\ndef unused_helper(a, b):\n    return a - b\n',
        },
      ],
      testCmd: TEST_CMD,
    });
    expect(report.verdict).toBe('UNSAFE');
  }, 180_000);

  it('mixed-language diff (covered .py + unassessable .ts) → UNPROVEN, never SAFE', async () => {
    if (!pythonHasCoverage()) return;
    const report = await verifyDiff({
      repoRoot: FIXTURE,
      edits: [
        {
          path: 'calc.py',
          newContent:
            'def add(a, b):\n    return b + a\n\n\ndef unused_helper(a, b):\n    return a - b\n',
        },
        { path: 'note.ts', newContent: 'export const note = 1;\n' },
      ],
      testCmd: TEST_CMD,
    });
    // The .py change alone would be SAFE, but the .ts change is unassessable by
    // the Python-only coverage tool — so the whole change must not read as SAFE.
    expect(report.verdict).toBe('UNPROVEN');
  }, 180_000);

  it('edit to UNCOVERED code, tests still pass → UNPROVEN', async () => {
    if (!pythonHasCoverage()) return;
    const report = await verifyDiff({
      repoRoot: FIXTURE,
      edits: [
        {
          path: 'calc.py',
          newContent:
            'def add(a, b):\n    return a + b\n\n\ndef unused_helper(a, b):\n    return a + b\n',
        },
      ],
      testCmd: TEST_CMD,
    });
    expect(report.verdict).toBe('UNPROVEN');
    expect(report.coverage.uncovered.length).toBeGreaterThanOrEqual(1);
  }, 180_000);

  it('a flaky test that heals on retry does NOT produce a false UNSAFE; flakyTests carries it', async () => {
    if (!pythonHasCoverage()) return;
    const root = await flakyFixture();
    const salt = `refactron-vd-flake-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    process.env.REFACTRON_FLAKE_SALT = salt;
    try {
      const report = await verifyDiff({
        repoRoot: root,
        edits: [{ path: 'lib.py', newContent: 'def add(a, b):\n    return a + b  # reordered\n' }],
        testCmd: TEST_CMD,
      });
      // The only after-run failure is the flake, which vanishes on the fresh
      // shadow retry: the diff must not be blamed (no false UNSAFE), and the id
      // surfaces. Coverage of the reordered line stays unproven, so UNPROVEN.
      expect(report.verdict).not.toBe('UNSAFE');
      expect(report.flakyTests).toContain('test_flaky.py::test_flaky');
    } finally {
      await fs.rm(path.join(os.tmpdir(), salt), { force: true });
      delete process.env.REFACTRON_FLAKE_SALT;
    }
  }, 180_000);
});
