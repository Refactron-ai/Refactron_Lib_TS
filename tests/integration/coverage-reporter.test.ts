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

// Probes BOTH, because the tests below drive `pytest -q` under coverage: an
// image with coverage but no pytest would fail rather than skip. Hoisted to
// module scope so `it.skipIf` can use it. An early `return` inside a test body
// reports PASSED and proves nothing, which is why new tests here use skipIf.
const NO_COVERAGE = (() => {
  try {
    execSync('python3 -c "import coverage, pytest"', { stdio: 'ignore' });
    return false;
  } catch {
    return true;
  }
})();

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

    // `it.skipIf`, never an early return. An early return reports PASSED, and
    // this is the ONLY proof that hoisting survives a real subprocess round
    // trip; the release workflow installs pytest without coverage, so an early
    // return would make that gate green while proving nothing.
    it.skipIf(NO_COVERAGE)(
      'hoists through a real coverage run, keeping the inherited env',
      async () => {
        // Hoisted assignments must ADD to the environment, not replace it: the
        // child still needs the inherited PATH to find python at all.
        //
        // The COVERAGE_FILE assertion below is deliberately weaker than it
        // looks. Flipping the spread order alone does NOT break it, because
        // `--data-file` is also passed on argv to both `coverage run` and
        // `coverage json`, and argv beats the environment. So this detects only
        // the CONJUNCTION of "ordering flipped" and "--data-file dropped". The
        // ordering is defence in depth, not the load-bearing protection.
        const bogus = path.join(
          os.tmpdir(),
          `refactron-should-not-be-used-${process.pid}.coverage`,
        );
        await fs.rm(bogus, { force: true });

        const result = await reportCoverage({
          projectRoot: FIXTURE,
          // Module form on purpose: a console entry point carrying PYTHONPATH is
          // declined now, since `-m` and a console script disagree about
          // sys.path[0]. This still exercises hoisting through a real subprocess.
          testCmd: `COVERAGE_FILE=${bogus} PYTHONPATH=. python3 -m pytest -q`,
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
      },
    );

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
      // A non-import-affecting prefix still hoists onto a console entry point,
      // so the hoist-stop is exercised here rather than short-circuited by the
      // import-affecting decline.
      expect(toCoverageRunArgs('FOO=1 pytest -k a=b')).toEqual({
        args: ['-m', 'pytest', '-k', 'a=b'],
        env: { FOO: '1' },
      });
      expect(toCoverageRunArgs('PYTHONPATH=. python3 -m pytest -k a=b')).toEqual({
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
      // The tests gate runs under `sh -c`, which expands `$HOME` and `~`.
      // Hoisting either literally would put a different path on sys.path for
      // the coverage run than the run we actually verified, so the measurement
      // would describe a run that never happened. Unknown is honest; a silent
      // mismatch is not.
      const { toCoverageRunArgs } =
        await import('../../src/analyze/coverage/python-line-coverage.js');

      expect(toCoverageRunArgs('PYTHONPATH=$HOME/x python3 -m pytest')).toBeNull();
      expect(toCoverageRunArgs('PYTHONPATH=$PWD python3 -m pytest')).toBeNull();
      // `sh` expands a tilde at the start of the value AND after each `:`,
      // because expansion applies per segment of a PATH-like value.
      expect(toCoverageRunArgs('PYTHONPATH=~/x python3 -m pytest')).toBeNull();
      expect(toCoverageRunArgs('PYTHONPATH=a:~/y python3 -m pytest')).toBeNull();
      // A tilde that is not at a segment boundary is literal to the shell too.
      expect(toCoverageRunArgs('PYTHONPATH=a~b python3 -m pytest')).toEqual({
        args: ['-m', 'pytest'],
        env: { PYTHONPATH: 'a~b' },
      });
      // A literal `$` in an ARGUMENT is not our problem to expand and was never
      // hoisted, so it keeps classifying as before.
      expect(toCoverageRunArgs('pytest -k "cost$"')).toEqual({
        args: ['-m', 'pytest', '-k', 'cost$'],
        env: {},
      });
    });

    it('matches shell semantics on assignment edge cases', async () => {
      // These four exist because a mutation run showed the rest of the suite
      // survives all of them. Diffing against main cannot prove them red: the
      // return SHAPE changed, so every assertion here goes red on main whether
      // or not it tests anything. Each case below was verified by mutating THIS
      // branch's implementation instead.
      const { toCoverageRunArgs } =
        await import('../../src/analyze/coverage/python-line-coverage.js');

      // Quote removal. A value class of `\S*` would stop matching here, the
      // token would classify as a COMMAND, and we would be back to issue #95
      // with a different first token.
      expect(toCoverageRunArgs('PYTHONPATH="a b" python3 -m pytest -q')).toEqual({
        args: ['-m', 'pytest', '-q'],
        env: { PYTHONPATH: 'a b' },
      });

      // A shell applies assignments left to right, so the last one wins.
      expect(toCoverageRunArgs('A=1 A=2 python3 -m pytest -q')).toEqual({
        args: ['-m', 'pytest', '-q'],
        env: { A: '2' },
      });

      // A shell reads `1BAD=x` as a COMMAND name, not an assignment, because
      // the name is not a valid identifier. Hoisting it would make the coverage
      // run succeed against a command the tests gate could never have run.
      expect(toCoverageRunArgs('1BAD=x python3 -m pytest -q')?.env).toEqual({});
      expect(toCoverageRunArgs('-k=v python3 -m pytest -q')?.env).toEqual({});

      // The default testCmd. `src/analyze/engine.ts` calls reportCoverage with
      // no testCmd at all, so 'pytest -q' is a second production caller of this
      // classifier and must keep classifying exactly as it did before hoisting.
      expect(toCoverageRunArgs('pytest -q')).toEqual({ args: ['-m', 'pytest', '-q'], env: {} });
    });

    it('runs a resolvable console entry point positionally, as the gate does (issue #98)', async () => {
      // `coverage run -m pytest` puts CWD on sys.path ahead of everything the
      // environment supplies, while the console script the gate runs does not.
      // On an editable install that difference made coverage measure the SHADOW
      // tree while the gate ran the INSTALLED one, and fusing those produced a
      // false SAFE for a change that broke the suite. Running the same file the
      // gate runs, positionally, puts sys.path[0] in the same place for both.
      const { toCoverageRunArgs } =
        await import('../../src/analyze/coverage/python-line-coverage.js');

      const resolves = (name: string) => `/venv/bin/${name}`;
      expect(toCoverageRunArgs('pytest -q', resolves)).toEqual({
        args: ['/venv/bin/pytest', '-q'],
        env: {},
      });
      // The prefix is hoisted and the entry point still resolves, so this is
      // measurable rather than declined: both spawns now agree.
      expect(toCoverageRunArgs('PYTHONPATH=src pytest -q', resolves)).toEqual({
        args: ['/venv/bin/pytest', '-q'],
        env: { PYTHONPATH: 'src' },
      });
      // Explicit module form is already equivalent on both sides and must NOT
      // be rewritten: the gate runs `python3 -m pytest` too.
      expect(toCoverageRunArgs('python3 -m pytest -q', resolves)).toEqual({
        args: ['-m', 'pytest', '-q'],
        env: {},
      });
      // A script path is already positional and must not be touched.
      expect(toCoverageRunArgs('python3 tests/runtests.py', resolves)).toEqual({
        args: ['tests/runtests.py'],
        env: {},
      });
    });

    it('keeps the historical module form when an entry point cannot be resolved', async () => {
      // Windows console scripts are `.exe` launchers, not Python files, so
      // `coverage run pytest.exe` cannot work. Falling back to what shipped
      // before means nothing that works today stops working; the import-affecting
      // decline below is what keeps that fallback from being unsound.
      const { toCoverageRunArgs } =
        await import('../../src/analyze/coverage/python-line-coverage.js');

      const resolvesNothing = () => null;
      expect(toCoverageRunArgs('pytest -q', resolvesNothing)).toEqual({
        args: ['-m', 'pytest', '-q'],
        env: {},
      });
      // Omitting the resolver entirely is the same historical behaviour.
      expect(toCoverageRunArgs('pytest -q')).toEqual({ args: ['-m', 'pytest', '-q'], env: {} });
      // Unresolvable AND import-affecting stays declined, because that is the
      // combination we cannot make equivalent.
      expect(toCoverageRunArgs('PYTHONPATH=src pytest -q', resolvesNothing)).toBeNull();
    });

    it('declines an import-affecting prefix on a console entry point', async () => {
      // The false SAFE. Rewriting a console script to module form is not
      // equivalent to the gate's spawn: `-m` puts CWD first on sys.path, ahead
      // of PYTHONPATH, while the console script the gate runs does not. With an
      // import-affecting variable set, that difference selects a DIFFERENT COPY
      // of the code, so the gate proves the original tree green while coverage
      // proves the shadow tree exercised, and the fusion reads SAFE for a change
      // that breaks the suite. Reproduced end to end before this decline existed.
      const { toCoverageRunArgs } =
        await import('../../src/analyze/coverage/python-line-coverage.js');

      expect(toCoverageRunArgs('PYTHONPATH=/elsewhere pytest -q')).toBeNull();
      expect(toCoverageRunArgs('PYTHONPATH=src pytest -q')).toBeNull();
      expect(toCoverageRunArgs('PYTHONHOME=/opt/py pytest')).toBeNull();
      expect(toCoverageRunArgs('PATH=/custom/bin pytest')).toBeNull();
      expect(toCoverageRunArgs('VIRTUAL_ENV=/venv pytest')).toBeNull();

      // Module form is equivalent on BOTH sides (`-m` there, `-m` here), so the
      // form the docs actually teach keeps working. This is the whole point of
      // declining narrowly rather than declining every prefixed command.
      expect(toCoverageRunArgs('PYTHONPATH=. python3 -m pytest -q')).toEqual({
        args: ['-m', 'pytest', '-q'],
        env: { PYTHONPATH: '.' },
      });
      // Script form is equivalent too: sys.path[0] is the script's directory in
      // both spawns.
      expect(toCoverageRunArgs('PYTHONPATH=. python3 tests/runtests.py')).toEqual({
        args: ['tests/runtests.py'],
        env: { PYTHONPATH: '.' },
      });
      // A variable that cannot change module resolution is still hoisted onto a
      // console entry point.
      expect(toCoverageRunArgs('COVERAGE_CORE=sysmon pytest -q')).toEqual({
        args: ['-m', 'pytest', '-q'],
        env: { COVERAGE_CORE: 'sysmon' },
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
