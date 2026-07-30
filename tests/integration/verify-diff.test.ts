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

  // Statement-level attribution. coverage.py attributes execution to a
  // statement's FIRST line, so a reformat that splits statements across lines
  // makes every continuation line look uncovered. Proven on pydantic: a black
  // reformat of `pydantic/_internal` reported 3666 "uncovered" entries, among
  // them lines 24-30 of _generate_schema.py: the names inside a
  // `from ipaddress import (...)` whose statement start (line 23) provably ran.
  describe('multi-line statements', () => {
    const MULTILINE = path.resolve(__dirname, '../fixtures/verify-diff-multiline');

    // shapes.py lines 1-4 are one `from math import (...)` statement. Swapping
    // the two imported names touches ONLY lines 2-3: the statement start is
    // unchanged, so it is not even in the changed set. This is the safety shape
    // (`x = [1,\n  3]` with only the continuation edited), so the change must be
    // attested by the enclosing statement, never dropped as unattributable.
    it('changed CONTINUATION lines of an executed statement → SAFE', async () => {
      if (!pythonHasCoverage()) return;
      const report = await verifyDiff({
        repoRoot: MULTILINE,
        edits: [
          {
            path: 'shapes.py',
            newContent: (await fs.readFile(path.join(MULTILINE, 'shapes.py'), 'utf8')).replace(
              '    ceil,\n    floor,\n',
              '    floor,\n    ceil,\n',
            ),
          },
        ],
        testCmd: TEST_CMD,
      });
      expect(report.verdict).toBe('SAFE');
      expect(report.coverage.uncovered).toEqual([]);
    }, 180_000);

    // The other half: unused_join's `return "-".join(` at line 16 never runs.
    // Editing three of its continuation lines (18, 19, 20) must report ONE
    // uncovered entry at line 16, the statement a human can write a test for,
    // not three entries at lines coverage.py never tracks.
    it('changed lines under an UNEXECUTED statement → one deduped entry at the start', async () => {
      if (!pythonHasCoverage()) return;
      const report = await verifyDiff({
        repoRoot: MULTILINE,
        edits: [
          {
            path: 'shapes.py',
            newContent: (await fs.readFile(path.join(MULTILINE, 'shapes.py'), 'utf8')).replace(
              '            a,\n            b,\n            c,\n',
              '            a.strip(),\n            b.strip(),\n            c.strip(),\n',
            ),
          },
        ],
        testCmd: TEST_CMD,
      });
      expect(report.verdict).toBe('UNPROVEN');
      expect(report.coverage.uncovered).toEqual([{ file: 'shapes.py', line: 16 }]);
      expect(report.missingTests).toEqual([
        { file: 'shapes.py', hint: 'add a test exercising shapes.py:16' },
      ]);
    }, 180_000);
  });

  // Statement-level attribution must not open a hole where coverage.py EXCLUDES
  // lines. `# pragma: no cover` (and `if TYPE_CHECKING:` under the usual
  // exclude_lines config) drops a statement from executed_lines AND
  // missing_lines, so a naive "executed UNION missing" executable set skips it
  // and the enclosing lookup walks BACKWARDS to the covered `def` line above.
  // The excluded body provably never ran, so attributing it to a covered
  // neighbour would manufacture a false SAFE. Excluded lines are executable.
  it('a change inside a `# pragma: no cover` body is never attributed to covered code', async () => {
    if (!pythonHasCoverage()) return;
    const PRAGMA = path.resolve(__dirname, '../fixtures/verify-diff-pragma');
    const report = await verifyDiff({
      repoRoot: PRAGMA,
      edits: [
        {
          path: 'gated.py',
          newContent: (await fs.readFile(path.join(PRAGMA, 'gated.py'), 'utf8')).replace(
            '            a,\n            b,\n',
            '            a.strip(),\n            b.strip(),\n',
          ),
        },
      ],
      testCmd: TEST_CMD,
    });
    expect(report.verdict).toBe('UNPROVEN');
    expect(report.coverage.uncovered.length).toBeGreaterThanOrEqual(1);
    // Never the `def dead(...)` line at 5: that one DID execute at import time,
    // and pointing the hint there would tell the user to test code that ran.
    expect(report.coverage.uncovered.every((u) => u.line >= 6)).toBe(true);
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
