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
