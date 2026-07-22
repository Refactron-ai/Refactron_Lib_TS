import { describe, it, expect } from 'vitest';
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
