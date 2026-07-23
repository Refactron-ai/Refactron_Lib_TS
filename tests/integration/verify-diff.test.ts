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

// A pytest project with one deterministically flaky test (fails once per tree
// via a cwd-relative marker, then passes) plus a source file the diff edits
// harmlessly. Exercises the full verifyDiff pipeline end to end.
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
      '',
      'def test_flaky():',
      '    marker = os.path.join(os.getcwd(), ".flake_marker")',
      '    if not os.path.exists(marker):',
      '        open(marker, "w").close()',
      '        raise AssertionError("flaky: first run in this tree fails")',
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
    const report = await verifyDiff({
      repoRoot: root,
      edits: [{ path: 'lib.py', newContent: 'def add(a, b):\n    return a + b  # reordered\n' }],
      testCmd: TEST_CMD,
    });
    // The only after-run failure is the flake, which vanishes on the same-shadow
    // retry: the diff must not be blamed (no false UNSAFE), and the id surfaces.
    expect(report.verdict).not.toBe('UNSAFE');
    expect(report.flakyTests).toContain('test_flaky.py::test_flaky');
  }, 180_000);
});
