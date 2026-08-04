import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { reportCoverage } from '../../src/analyze/coverage/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURE = path.resolve(__dirname, '../fixtures/coverage-mini');

function pythonHasCoverage(): boolean {
  try {
    execSync('python3 -c "import coverage"', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('python-line-coverage reporter', () => {
  it('returns covered lines for a tested function and skips untested', async () => {
    if (!pythonHasCoverage()) {
      // eslint-disable-next-line no-console
      console.warn('skipping: coverage.py not installed');
      return;
    }
    const result = await reportCoverage({ projectRoot: FIXTURE, testCmd: 'pytest -q' });
    expect(result.coverageToolFound).toBe(true);
    expect(result.coveredLines.has('svc_tested.py:2')).toBe(true); // tested_function return
    expect(result.coveredLines.has('svc_tested.py:5')).toBe(false); // untested_function return
    expect([...result.coveredLines].some((k) => k.startsWith('svc_untouched.py:'))).toBe(false);
  });

  // coverage.py only ever marks the FIRST line of a statement. Continuation
  // lines, closing brackets, comments and blanks are never in executed_lines, so
  // a physical-line consumer reports them all as uncovered. executed_lines UNION
  // missing_lines is the file's statement-START set, which is what lets a
  // consumer map a changed line to the statement that actually ran.
  it('exposes the executable (statement-start) line set per file', async () => {
    if (!pythonHasCoverage()) {
      // eslint-disable-next-line no-console
      console.warn('skipping: coverage.py not installed');
      return;
    }
    const result = await reportCoverage({ projectRoot: FIXTURE, testCmd: 'pytest -q' });
    const svc = result.executableLines.get('svc_tested.py');
    expect(svc).toBeDefined();
    // Both the executed `return 42` (line 2) and the missing `return 99` (line
    // 5) are executable; the blank separator line 3 is not.
    expect(svc?.has(2)).toBe(true);
    expect(svc?.has(5)).toBe(true);
    expect(svc?.has(3)).toBe(false);
    // Keyed the same way as coveredLines, so `${rel}:${line}` lookups line up.
    expect([...result.executableLines.keys()]).toContain('svc_tested.py');
    // Every covered line is by definition executable.
    for (const key of result.coveredLines) {
      const idx = key.lastIndexOf(':');
      const file = key.slice(0, idx);
      const line = Number(key.slice(idx + 1));
      expect(result.executableLines.get(file)?.has(line)).toBe(true);
    }
  });

  // coverage.py drops EXCLUDED statements (`# pragma: no cover`, and whatever
  // else the project's exclude_lines matches) from executed_lines AND
  // missing_lines, reporting them in a third list. They are still statements, so
  // leaving them out of the executable set makes a consumer's enclosing-statement
  // lookup skip backwards past them onto whatever covered statement precedes,
  // turning provably-unexecuted code into apparently-covered code.
  it('counts EXCLUDED lines as executable so they cannot be attributed away', async () => {
    if (!pythonHasCoverage()) {
      // eslint-disable-next-line no-console
      console.warn('skipping: coverage.py not installed');
      return;
    }
    const pragma = path.resolve(__dirname, '../fixtures/verify-diff-pragma');
    const result = await reportCoverage({ projectRoot: pragma, testCmd: 'pytest -q' });
    const gated = result.executableLines.get('gated.py');
    expect(gated).toBeDefined();
    // `return "-".join(` at line 6 opens the pragma'd body: excluded, never
    // executed, and it must still be a statement the consumer can land on.
    expect(gated?.has(6)).toBe(true);
    expect(result.coveredLines.has('gated.py:6')).toBe(false);
    // The `def dead(...)` line is excluded too, so it must also be executable.
    // Deliberately NOT asserting that it appears in coveredLines: whether an
    // excluded line is ALSO reported as executed varies by coverage.py and
    // Python version (3.13 reports both, 3.11 reports excluded only), and that
    // incidental detail is not the property this test defends.
    expect(gated?.has(5)).toBe(true);
  });

  it('returns coverageToolFound=false when coverage.py is absent', async () => {
    // Force absence by pointing testCmd at a python that can't import coverage —
    // simulate via PATH override or just by inspecting the negative branch.
    // For this test we assert the shape when probe fails.
    const result = await reportCoverage({
      projectRoot: FIXTURE,
      testCmd: 'pytest -q',
      _probeOverride: false, // injected for test isolation
    });
    expect(result.coverageToolFound).toBe(false);
    expect(result.coveredLines.size).toBe(0);
    expect(result.executableLines.size).toBe(0);
  });

  it('reports toolFound=false when import succeeds but coverage cannot run', async () => {
    // The namespace-package ghost: a directory literally named `coverage/` on
    // sys.path (e.g. a vitest/jest HTML coverage OUTPUT dir in the cwd) makes
    // `python3 -c "import coverage"` succeed with coverage.__file__ = None,
    // while `python3 -m coverage run` fails (no __main__ in a data dir). The
    // probe must therefore test module EXECUTION, not importability. Simulate
    // with a shim python that accepts `-c import coverage` but fails `-m
    // coverage`: the reporter must report the tool as absent, not silently
    // return empty coverage under toolFound=true.
    const shimDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cov-shim-'));
    const shim = path.join(shimDir, 'python-ghost');
    await fs.writeFile(
      shim,
      '#!/bin/sh\ncase "$*" in *"-m coverage"*) exit 1;; *) exit 0;; esac\n',
      { mode: 0o755 },
    );
    await fs.writeFile(path.join(shimDir, 'python-ghost.bat'), '@echo off\r\nexit /b 1\r\n');
    const result = await reportCoverage({
      projectRoot: FIXTURE,
      testCmd: 'pytest -q',
      pythonBin: shim,
    });
    expect(result.coverageToolFound).toBe(false);
    expect(result.coveredLines.size).toBe(0);
  });

  // Script-form test commands (Django's `python3 tests/runtests.py`, manage.py
  // test, custom runners) are extremely common. The old code stripped only a
  // `python -m ` prefix and then unconditionally re-added `-m`, so it ran
  // `coverage run -m python3 tests/runtests.py`, tried to execute a MODULE named
  // "python3", failed, swallowed the failure, and returned an empty covered set:
  // covered Django code read as "not exercised by any test". Proven against
  // django/django during round-4 hardening.
  describe('test-command forms', () => {
    async function scriptRunnerFixture(): Promise<string> {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cov-script-'));
      await fs.writeFile(
        path.join(dir, 'svc.py'),
        'def used():\n    return 1\n\n\ndef unused():\n    return 2\n',
      );
      await fs.writeFile(
        path.join(dir, 'runtests.py'),
        'import sys, os\nsys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))\n' +
          'from svc import used\nassert used() == 1\nprint("ok")\n',
      );
      return dir;
    }

    it('measures coverage for a SCRIPT-form test command', async () => {
      if (!pythonHasCoverage()) return;
      const dir = await scriptRunnerFixture();
      const result = await reportCoverage({ projectRoot: dir, testCmd: 'python3 runtests.py' });
      expect(result.coverageToolFound).toBe(true);
      expect(result.measurementFailed).toBe(false);
      expect(result.coveredLines.has('svc.py:2')).toBe(true); // used() return
      expect(result.coveredLines.has('svc.py:6')).toBe(false); // unused() return
    });

    it('still measures coverage for module-form commands (regression guard)', async () => {
      if (!pythonHasCoverage()) return;
      for (const testCmd of ['python3 -m pytest -q', 'pytest -q']) {
        const result = await reportCoverage({ projectRoot: FIXTURE, testCmd });
        expect(result.measurementFailed).toBe(false);
        expect(result.coveredLines.has('svc_tested.py:2')).toBe(true);
      }
    });

    it('reports measurementFailed when the coverage run cannot execute', async () => {
      if (!pythonHasCoverage()) return;
      const dir = await scriptRunnerFixture();
      const result = await reportCoverage({
        projectRoot: dir,
        testCmd: 'python3 no_such_runner_qq.py',
      });
      // Never claim zero coverage when we could not measure at all.
      expect(result.measurementFailed).toBe(true);
      expect(result.coveredLines.size).toBe(0);
    });

    it('keeps quoted arguments intact when tokenizing', async () => {
      // The tests gate runs the command through a shell, so `-k "not slow"` is
      // ONE argument there. A naive whitespace split turns it into `"not` and
      // `slow"`, which changes which tests run and therefore what gets measured.
      const { toCoverageRunArgs } =
        await import('../../src/analyze/coverage/python-line-coverage.js');
      expect(toCoverageRunArgs('pytest tests/ -k "not slow"')).toEqual({
        args: ['-m', 'pytest', 'tests/', '-k', 'not slow'],
        env: {},
      });
      expect(toCoverageRunArgs("pytest -k 'a or b'")).toEqual({
        args: ['-m', 'pytest', '-k', 'a or b'],
        env: {},
      });
      expect(toCoverageRunArgs('python3 tests/runtests.py "my app"')).toEqual({
        args: ['tests/runtests.py', 'my app'],
        env: {},
      });
    });

    it('hoists a leading NAME=VALUE prefix into the environment (issue #95)', async () => {
      // The tests gate runs the command via `sh -c`, where `PYTHONPATH=. pytest`
      // is an env assignment. The coverage runner spawns argv directly, so it
      // used to classify the assignment as a MODULE NAME and emit
      // `-m PYTHONPATH=. python3 ...`. coverage then imported nothing, wrote no
      // data file, and every such project capped at UNPROVEN forever -- while
      // `PYTHONPATH=` is our own documented remedy for shadow bypass.
      const { toCoverageRunArgs } =
        await import('../../src/analyze/coverage/python-line-coverage.js');

      expect(toCoverageRunArgs('PYTHONPATH=. python3 -m pytest -q')).toEqual({
        args: ['-m', 'pytest', '-q'],
        env: { PYTHONPATH: '.' },
      });
      expect(toCoverageRunArgs('PYTHONPATH=src python3 -m pytest -q')).toEqual({
        args: ['-m', 'pytest', '-q'],
        env: { PYTHONPATH: 'src' },
      });
      // The slash used to divert this one into the script-form branch, so it
      // failed differently but just as silently.
      expect(toCoverageRunArgs('PYTHONPATH=./src python3 -m pytest -q')).toEqual({
        args: ['-m', 'pytest', '-q'],
        env: { PYTHONPATH: './src' },
      });
      expect(toCoverageRunArgs('COVERAGE_CORE=sysmon python3 -m pytest')).toEqual({
        args: ['-m', 'pytest'],
        env: { COVERAGE_CORE: 'sysmon' },
      });
      // Several assignments in a row, and the remainder still classifies as
      // script form rather than module form.
      expect(toCoverageRunArgs('A=1 B=2 python3 tests/runtests.py')).toEqual({
        args: ['tests/runtests.py'],
        env: { A: '1', B: '2' },
      });
      // An empty value is a legitimate assignment (`FOO= cmd` unsets in shell).
      expect(toCoverageRunArgs('PYTHONPATH= python3 -m pytest')).toEqual({
        args: ['-m', 'pytest'],
        env: { PYTHONPATH: '' },
      });
    });

    it('merges hoisted vars into the inherited env without losing COVERAGE_FILE', async () => {
      // Hoisted assignments must ADD to the environment, not replace it: the
      // child still needs the inherited PATH to find python at all. And
      // COVERAGE_FILE is applied last on purpose, so a test command that sets
      // it cannot redirect the data file we are about to read. If it could,
      // the run would look exactly like "coverage measured nothing", which is
      // the same silent UNPROVEN this issue is about.
      if (!pythonHasCoverage()) {
        // eslint-disable-next-line no-console
        console.warn('skipping: coverage.py not installed');
        return;
      }
      const bogus = path.join(os.tmpdir(), 'refactron-should-not-be-used.coverage');
      await fs.rm(bogus, { force: true });

      const result = await reportCoverage({
        projectRoot: FIXTURE,
        testCmd: `COVERAGE_FILE=${bogus} PYTHONPATH=. pytest -q`,
      });

      expect(result.coverageToolFound).toBe(true);
      expect(result.measurementFailed).toBe(false);
      // Real data came back, so PATH survived and our data file won.
      expect(result.coveredLines.has('svc_tested.py:2')).toBe(true);
      expect(
        await fs
          .access(bogus)
          .then(() => true)
          .catch(() => false),
      ).toBe(false);
    });

    it('stops hoisting at the first token that is not an assignment', async () => {
      // `-k a=b` is a pytest ARGUMENT that happens to contain `=`. Eating it
      // would silently change which tests run, so the measured run would no
      // longer be the verified run.
      const { toCoverageRunArgs } =
        await import('../../src/analyze/coverage/python-line-coverage.js');

      expect(toCoverageRunArgs('pytest -k a=b')).toEqual({
        args: ['-m', 'pytest', '-k', 'a=b'],
        env: {},
      });
      expect(toCoverageRunArgs('PYTHONPATH=. pytest -k a=b')).toEqual({
        args: ['-m', 'pytest', '-k', 'a=b'],
        env: { PYTHONPATH: '.' },
      });
      // A leading token that is not a valid shell identifier is not an
      // assignment: `-k=v` is a flag, and `1BAD=x` cannot be an env name.
      expect(toCoverageRunArgs('pytest --opt=1')).toEqual({
        args: ['-m', 'pytest', '--opt=1'],
        env: {},
      });
      // Nothing left to run once the assignments are removed.
      expect(toCoverageRunArgs('PYTHONPATH=.')).toBeNull();
    });

    it('declines a hoisted value the shell would expand', async () => {
      // The tests gate runs under `sh -c`, which expands `$HOME`. Hoisting it
      // literally would put a different path on sys.path for the coverage run
      // than the run we actually verified, so the measurement would describe a
      // run that never happened. Unknown is honest; a silent mismatch is not.
      const { toCoverageRunArgs } =
        await import('../../src/analyze/coverage/python-line-coverage.js');

      expect(toCoverageRunArgs('PYTHONPATH=$HOME/x python3 -m pytest')).toBeNull();
      expect(toCoverageRunArgs('PYTHONPATH=$PWD python3 -m pytest')).toBeNull();
      // A literal `$` in an ARGUMENT is not our problem to expand and was never
      // hoisted, so it keeps classifying as before.
      expect(toCoverageRunArgs('pytest -k "cost$"')).toEqual({
        args: ['-m', 'pytest', '-k', 'cost$'],
        env: {},
      });
    });

    it('reports measurementFailed when the report step fails after a good run', async () => {
      // A shim python that satisfies the probe and the `coverage run` (writing a
      // data file) but fails `coverage json`. The old code swallowed that and
      // returned an empty covered set as if measured: the same lie this module
      // exists to prevent.
      if (process.platform === 'win32') return;
      const shimDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cov-jsonfail-'));
      const shim = path.join(shimDir, 'python-jsonfail');
      await fs.writeFile(
        shim,
        '#!/bin/sh\n' +
          'case "$*" in\n' +
          '  *"coverage --version"*) exit 0 ;;\n' +
          '  *"coverage run"*)\n' +
          '     for a in "$@"; do case "$a" in *.coverage) : > "$a" ;; esac; done\n' +
          '     exit 0 ;;\n' +
          '  *"coverage json"*) echo "boom" >&2; exit 1 ;;\n' +
          '  *) exit 0 ;;\n' +
          'esac\n',
        { mode: 0o755 },
      );
      const result = await reportCoverage({
        projectRoot: FIXTURE,
        testCmd: 'pytest -q',
        pythonBin: shim,
      });
      expect(result.measurementFailed).toBe(true);
      expect(result.coveredLines.size).toBe(0);
    });

    it('refuses to guess at shell-composite commands', async () => {
      if (!pythonHasCoverage()) return;
      const result = await reportCoverage({
        projectRoot: FIXTURE,
        testCmd: 'pytest -q && echo done',
      });
      expect(result.measurementFailed).toBe(true);
      expect(result.coveredLines.size).toBe(0);
    });
  });

  it('still reports real files when the suite executes phantom-filename code', async () => {
    // A suite that runs exec(compile(src, "string", "exec")) makes coverage.py
    // record a measured "file" named `string` with no source on disk. Without
    // --ignore-errors, `coverage json` exits non-zero and writes nothing, and
    // the reporter silently degrades to zero covered lines: every SAFE verdict
    // on such a project (e.g. Textualize/rich) falsely reads UNPROVEN.
    if (!pythonHasCoverage()) {
      // eslint-disable-next-line no-console
      console.warn('skipping: coverage.py not installed');
      return;
    }
    const phantom = path.resolve(__dirname, '../fixtures/coverage-phantom');
    const result = await reportCoverage({ projectRoot: phantom, testCmd: 'pytest -q' });
    expect(result.coverageToolFound).toBe(true);
    expect(result.coveredLines.has('svc.py:2')).toBe(true); // covered_function return
  });
});
