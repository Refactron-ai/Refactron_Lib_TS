import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
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
});
