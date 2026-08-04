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

// `it.skipIf`, never `if (...) return;`. An early return reports PASSED, so on a
// CI image without coverage.py the entire false-SAFE safety net would go green
// while proving nothing. A skip is visible in the runner summary.
const NO_COVERAGE = !pythonHasCoverage();

// Fixture bytes are pinned to LF by .gitattributes, but a clone made before that
// (or a stray core.autocrlf) would hand these tests CRLF, and every edit here is
// built by replacing an LF-delimited snippet. A silent no-match makes the "edit"
// identical to the base, which reads as UNPROVEN rather than a failed assertion,
// so normalize on read and let the tests fail loudly if a snippet is wrong.
async function readFixture(file: string): Promise<string> {
  return (await fs.readFile(file, 'utf8')).replace(/\r\n/g, '\n');
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

// A src-layout project: `pkg` lives under src/, and pytest is given no
// `pythonpath`, so nothing is importable unless PYTHONPATH says where to look.
// That is what makes it a real test of the env prefix: with `PYTHONPATH=src`
// the SHADOW copy is imported, and with an absolute PYTHONPATH into the
// ORIGINAL tree the shadow copy is never imported at all.
async function srcLayoutFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-srclayout-'));
  await fs.mkdir(path.join(root, 'src', 'pkg'), { recursive: true });
  await fs.mkdir(path.join(root, 'tests'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'pyproject.toml'),
    '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n',
  );
  await fs.writeFile(
    path.join(root, 'src', 'pkg', '__init__.py'),
    'def add(a, b):\n    return a + b\n\n\ndef unused_helper(a, b):\n    return a - b\n',
  );
  await fs.writeFile(
    path.join(root, 'tests', 'test_pkg.py'),
    'from pkg import add\n\n\ndef test_add():\n    assert add(2, 3) == 5\n',
  );
  return root;
}

const REORDERED_PKG =
  'def add(a, b):\n    return b + a\n\n\ndef unused_helper(a, b):\n    return a - b\n';

describe('verifyDiff with a NAME=VALUE prefix on testCmd (issue #95)', () => {
  it.skipIf(NO_COVERAGE)(
    'PYTHONPATH= prefix still measures coverage and can reach SAFE',
    async () => {
      // Before the fix this reported coverage.tool "none" and UNPROVEN: the
      // assignment was classified as a module name, `coverage run` imported
      // nothing, and no data file was written. The tests gate passed either
      // way, so the failure was invisible.
      const root = await srcLayoutFixture();
      const report = await verifyDiff({
        repoRoot: root,
        edits: [{ path: 'src/pkg/__init__.py', newContent: REORDERED_PKG }],
        testCmd: 'PYTHONPATH=src python3 -m pytest -q',
      });
      // Assert the MEASUREMENT, not just the verdict string. A test that only
      // checks for SAFE would also pass if SAFE were reached without coverage.
      expect(report.coverage.tool).toBe('coverage.py');
      expect(report.coverage.changedStatements?.covered ?? 0).toBeGreaterThan(0);
      expect(report.verdict).toBe('SAFE');
    },
    180_000,
  );

  it.skipIf(NO_COVERAGE)(
    'a PYTHONPATH pointing OUTSIDE the shadow tree must not read SAFE',
    async () => {
      // The adversarial half. Hoisting env vars is exactly the mechanism that
      // could aim the suite at code the shadow tree does not contain: here the
      // tests import the ORIGINAL package, pass against unmodified code, and
      // never load the changed copy. The changed file is therefore never
      // measured, the shadow-bypass guard fires, and the verdict degrades.
      // If this ever reads SAFE, this fix has introduced a false SAFE.
      const root = await srcLayoutFixture();
      const edits = [{ path: 'src/pkg/__init__.py', newContent: REORDERED_PKG }];

      // Run BOTH forms against the same fixture and the same edit, so the only
      // variable is where PYTHONPATH points. Asserting the pair is what keeps
      // this test honest: a lone UNPROVEN assertion would also pass if the
      // coverage wrapper had simply broken again, which is the bug this branch
      // fixes. Pinning the sibling to SAFE proves measurement works for this
      // command shape, so the degradation is about the TARGET, not the wrapper.
      //
      // It deliberately does not assert WHICH mechanism degraded the verdict.
      // Two cover this independently: the shadow-bypass guard (the changed file
      // is absent from measuredFiles), and ordinary attribution (its statements
      // show no coverage). Verified by disabling the guard, after which this
      // still reads UNPROVEN. `coverage.tool` cannot separate them either,
      // since a failed measurement and a fired guard both return
      // unknownCoverage() and report "none". The property under test is the one
      // that matters and the one both paths deliver: never SAFE.
      const intoShadow = await verifyDiff({
        repoRoot: root,
        edits,
        testCmd: 'PYTHONPATH=src python3 -m pytest -q',
      });
      const intoOriginal = await verifyDiff({
        repoRoot: root,
        edits,
        testCmd: `PYTHONPATH=${path.join(root, 'src')} python3 -m pytest -q`,
      });

      // Measurement demonstrably works for this command shape...
      expect(intoShadow.coverage.tool).toBe('coverage.py');
      expect(intoShadow.verdict).toBe('SAFE');
      // ...so aiming the same shape outside the shadow tree can only have been
      // rejected by the guard, not by a broken wrapper.
      expect(intoOriginal.verdict).not.toBe('SAFE');
      expect(intoOriginal.verdict).toBe('UNPROVEN');
    },
    180_000,
  );
});

describe('verifyDiff (python three-way, real coverage)', () => {
  it.skipIf(NO_COVERAGE)(
    'semantics-preserving edit to COVERED code → SAFE',
    async () => {
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
    },
    180_000,
  );

  it.skipIf(NO_COVERAGE)(
    'behavior-breaking edit to COVERED code → UNSAFE',
    async () => {
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
    },
    180_000,
  );

  it.skipIf(NO_COVERAGE)(
    'mixed-language diff (covered .py + unassessable .ts) → UNPROVEN, never SAFE',
    async () => {
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
      // the Python-only coverage tool, so the whole change must not read as SAFE.
      expect(report.verdict).toBe('UNPROVEN');
    },
    180_000,
  );

  it.skipIf(NO_COVERAGE)(
    'edit to UNCOVERED code, tests still pass → UNPROVEN',
    async () => {
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
    },
    180_000,
  );

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
    it.skipIf(NO_COVERAGE)(
      'changed CONTINUATION lines of an executed statement → SAFE',
      async () => {
        const report = await verifyDiff({
          repoRoot: MULTILINE,
          edits: [
            {
              path: 'shapes.py',
              newContent: (await readFixture(path.join(MULTILINE, 'shapes.py'))).replace(
                '    ceil,\n    floor,\n',
                '    floor,\n    ceil,\n',
              ),
            },
          ],
          testCmd: TEST_CMD,
        });
        expect(report.verdict).toBe('SAFE');
        expect(report.coverage.uncovered).toEqual([]);
      },
      180_000,
    );

    // The other half: unused_join's `return "-".join(` at line 16 never runs.
    // Editing three of its continuation lines (18, 19, 20) must report ONE
    // uncovered entry at line 16, the statement a human can write a test for,
    // not three entries at lines coverage.py never tracks.
    it.skipIf(NO_COVERAGE)(
      'changed lines under an UNEXECUTED statement → one deduped entry at the start',
      async () => {
        const report = await verifyDiff({
          repoRoot: MULTILINE,
          edits: [
            {
              path: 'shapes.py',
              newContent: (await readFixture(path.join(MULTILINE, 'shapes.py'))).replace(
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
      },
      180_000,
    );
  });

  // Statement-level attribution must not open a hole where coverage.py EXCLUDES
  // lines. `# pragma: no cover` (and `if TYPE_CHECKING:` under the usual
  // exclude_lines config) drops a statement from executed_lines AND
  // missing_lines. Measured on coverage 7.11, gated.py reports
  // executed=[1,2,5] missing=[] excluded=[5,6,7,8,9,10,11]: the exclusion is the
  // whole PHYSICAL BLOCK, not statement starts, so a set built from those lists
  // cannot tell the `return "-".join(` at 6 from its continuation lines 7-11.
  // AST containment can: lines 8-9 are inside the return statement that starts
  // at 6, which coverage never marked executed. One entry, at a line a human can
  // read, and never the `def dead(...)` at 5 (that one DID run at import time).
  it.skipIf(NO_COVERAGE)(
    'a change inside a `# pragma: no cover` body maps to the excluded statement, once',
    async () => {
      const PRAGMA = path.resolve(__dirname, '../fixtures/verify-diff-pragma');
      const report = await verifyDiff({
        repoRoot: PRAGMA,
        edits: [
          {
            path: 'gated.py',
            newContent: (await readFixture(path.join(PRAGMA, 'gated.py'))).replace(
              '            a,\n            b,\n',
              '            a.strip(),\n            b.strip(),\n',
            ),
          },
        ],
        testCmd: TEST_CMD,
      });
      expect(report.verdict).toBe('UNPROVEN');
      // Exact, not `length >= 1` + `every(line >= 6)`: those pass on the
      // physical-line mechanism too (it reports 8 and 9), so they proved nothing.
      expect(report.coverage.uncovered).toEqual([{ file: 'gated.py', line: 6, excluded: true }]);
      // A deliberately excluded statement cannot be reached by any test, so the
      // hint must not tell the user to write one.
      expect(report.missingTests?.[0]?.hint).toContain('excluded from coverage');
      expect(report.missingTests?.[0]?.hint).not.toContain('add a test');
    },
    180_000,
  );

  // `if TYPE_CHECKING:` is the shape that dominates real code (pydantic) and the
  // one the module comments cite, yet it had no test at all. Measured on
  // coverage 7.11: executed=[1,3,10,11] excluded=[3,4]. Line 3 (`if
  // TYPE_CHECKING:`) DOES execute at import time; line 4 (the guarded import)
  // never does. A change to the import's continuation lines must land on 4.
  it.skipIf(NO_COVERAGE)(
    'a change inside `if TYPE_CHECKING:` maps to the guarded import, never the executed guard',
    async () => {
      const TC = path.resolve(__dirname, '../fixtures/verify-diff-type-checking');
      const report = await verifyDiff({
        repoRoot: TC,
        edits: [
          {
            path: 'mod.py',
            newContent: (await readFixture(path.join(TC, 'mod.py'))).replace(
              '        Context,\n        Decimal,\n',
              '        Decimal,\n        Context,\n',
            ),
          },
        ],
        testCmd: TEST_CMD,
      });
      expect(report.verdict).toBe('UNPROVEN');
      expect(report.coverage.uncovered).toEqual([{ file: 'mod.py', line: 4, excluded: true }]);
      expect(report.coverage.uncovered.some((u) => u.line === 3)).toBe(false);
    },
    180_000,
  );

  // THE FALSE SAFE THIS BRANCH INTRODUCED. `enclosing(L) = max{stmt start <= L}`
  // cannot tell a continuation line of a statement from a blank/comment line
  // that merely FOLLOWS it, so an executed neighbour vouched for code in a
  // different, unexecuted block. Every case below pairs an untested behavior
  // change with one semantically inert edit; on the physical-line mechanism the
  // inert edit alone flipped the whole file to "exercised" and the verdict to
  // SAFE, with the disproof deleted from the report. Formatters insert and
  // remove blank lines constantly, so this is the exact motivating workload.
  describe('semantically inert lines never vouch for unexecuted code', () => {
    const INERT = path.resolve(__dirname, '../fixtures/verify-diff-inert');
    const BREAK_UNTESTED = [
      'def never_called(a, b):\n    return a + b',
      'def never_called(a, b):\n    return a * b',
    ] as const;

    async function inertSource(): Promise<string> {
      return readFixture(path.join(INERT, 'mod.py'));
    }

    async function runInert(newContent: string) {
      return verifyDiff({
        repoRoot: INERT,
        edits: [{ path: 'mod.py', newContent }],
        testCmd: TEST_CMD,
      });
    }

    // The reproduced regression: ONE added blank line between two functions,
    // plus `a + b` -> `a * b` inside a function no test calls.
    it.skipIf(NO_COVERAGE)(
      'a changed BLANK line does not make an untested change read as covered',
      async () => {
        const report = await runInert(
          (await inertSource())
            .replace(
              '    return a + b\n\n\ndef never_called',
              '    return a + b\n\n\n\ndef never_called',
            )
            .replace(...BREAK_UNTESTED),
        );
        expect(report.verdict).toBe('UNPROVEN');
        expect(report.coverage.uncovered).toEqual([{ file: 'mod.py', line: 12 }]);
      },
      180_000,
    );

    it.skipIf(NO_COVERAGE)(
      'a changed COMMENT line does not make an untested change read as covered',
      async () => {
        const report = await runInert(
          (await inertSource())
            .replace('# a comment in a tested body', '# a comment in a tested body, reworded')
            .replace(...BREAK_UNTESTED),
        );
        expect(report.verdict).toBe('UNPROVEN');
        expect(report.coverage.uncovered).toEqual([{ file: 'mod.py', line: 11 }]);
      },
      180_000,
    );

    // A function docstring is a real `Expr` statement in the AST, so the change
    // lands on its own line. coverage.py does not track function docstrings at
    // all (measured: line 5 appears in none of executed/missing/excluded), so
    // that statement reads as unexecuted, which is the honest answer.
    it.skipIf(NO_COVERAGE)(
      'a changed DOCSTRING line does not make an untested change read as covered',
      async () => {
        const report = await runInert(
          (await inertSource())
            .replace('"""Add two numbers."""', '"""Add two integers."""')
            .replace(...BREAK_UNTESTED),
        );
        expect(report.verdict).toBe('UNPROVEN');
        expect(report.coverage.uncovered).toEqual([
          { file: 'mod.py', line: 5 },
          { file: 'mod.py', line: 11 },
        ]);
      },
      180_000,
    );

    // The compiler folds `if False:` away, so coverage 7.11 reports its body in
    // NONE of executed/missing/excluded (measured: mod.py executed=[1,4,7,10,14]
    // missing=[11], line 15 in no list). `executed U missing U excluded` is
    // therefore still not the executable set, and a walk-back landed on the
    // `if False:` header at 14, which DOES execute. AST containment lands inside.
    it.skipIf(NO_COVERAGE)(
      'a change inside `if False:` is not vouched for by the executed guard above it',
      async () => {
        const report = await runInert(
          (await inertSource()).replace('    dead = 1', '    dead = 2'),
        );
        expect(report.verdict).toBe('UNPROVEN');
        expect(report.coverage.uncovered).toEqual([{ file: 'mod.py', line: 15 }]);
      },
      180_000,
    );

    // Nothing but a blank line moved. Inert lines can neither change behavior
    // nor be proven by a test, so there is nothing to attest, but the diff also
    // cannot prove the file is unchanged (a deletion is invisible in the added
    // lines), so this gets the removal-only treatment, not a free SAFE.
    it.skipIf(NO_COVERAGE)(
      'a file whose changed lines are ALL inert has nothing to attest, not a free pass',
      async () => {
        const report = await runInert(
          (await inertSource()).replace(
            '    return a + b\n\n\ndef never_called',
            '    return a + b\n\n\n\ndef never_called',
          ),
        );
        expect(report.verdict).toBe('UNPROVEN');
        expect(report.coverage.uncovered).toEqual([]);
        expect(report.coverage.inertOnlyFiles).toEqual(['mod.py']);
        expect(report.reason).toContain('comments');
      },
      180_000,
    );

    // A SAFE report must still disclose the changed statements that provably did
    // not run. Suppressing them is what made the false SAFE invisible.
    it.skipIf(NO_COVERAGE)(
      'a SAFE verdict still discloses its unexercised statements and the ratio',
      async () => {
        const report = await runInert(
          (await inertSource())
            .replace(
              '    return a + b\n\n\ndef never_called',
              '    return b + a\n\n\ndef never_called',
            )
            .replace(...BREAK_UNTESTED),
        );
        expect(report.verdict).toBe('SAFE');
        expect(report.coverage.uncovered).toEqual([{ file: 'mod.py', line: 11 }]);
        expect(report.coverage.changedStatements).toEqual({ total: 2, covered: 1 });
        expect(report.reportVersion).toBe(1);
      },
      180_000,
    );
  });

  it.skipIf(NO_COVERAGE)(
    'a flaky test that heals on retry does NOT produce a false UNSAFE; flakyTests carries it',
    async () => {
      const root = await flakyFixture();
      const salt = `refactron-vd-flake-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      process.env.REFACTRON_FLAKE_SALT = salt;
      try {
        const report = await verifyDiff({
          repoRoot: root,
          edits: [
            { path: 'lib.py', newContent: 'def add(a, b):\n    return a + b  # reordered\n' },
          ],
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
    },
    180_000,
  );
});
