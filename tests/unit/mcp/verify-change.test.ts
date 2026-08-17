import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleVerifyChange } from '../../../src/mcp/tools/verify-change.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '../../fixtures/verify-diff-mini');

function pythonHasCoverage(): boolean {
  try {
    execSync('python3 -c "import coverage, pytest"', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Silent, and guarding the ONLY assertion that the MCP tool can produce SAFE.
// On any image without coverage.py this reported PASSED while proving nothing
// about the surface every agent actually calls.
const NO_COVERAGE = !pythonHasCoverage();

describe('handleVerifyChange', () => {
  it.skipIf(NO_COVERAGE)(
    'returns a structured verdict for a SAFE change',
    async () => {
      const res = await handleVerifyChange({
        repoRoot: FIXTURE,
        edits: [
          {
            path: 'calc.py',
            newContent:
              'def add(a, b):\n    return b + a\n\n\ndef unused_helper(a, b):\n    return a - b\n',
          },
        ],
        testCmd: 'python3 -m pytest -q',
      });
      const report = JSON.parse(res.content[0]!.text);
      expect(report.verdict).toBe('SAFE');
      expect(res.isError).toBeFalsy();
      // testScope is a VERDICT INPUT (#112), and this is the surface every agent
      // calls. The report is serialized verbatim so the field is carried
      // structurally, but "structurally carried" is an argument, not a test:
      // nothing here asserted it, so a regression that dropped it would be
      // invisible exactly where it matters most.
      expect(report.testScope).toEqual({
        scope: 'full',
        source: 'override',
        signals: [],
      });
    },
    180_000,
  );

  it.skipIf(NO_COVERAGE)(
    'reports a narrowed scope on the MCP surface, and floors the verdict',
    async () => {
      // An agent narrowing to the tests it just wrote is the threat model
      // ADR-12 exists for, and the MCP server applies no authentication, so
      // this is the realistic caller rather than an edge case.
      const res = await handleVerifyChange({
        repoRoot: FIXTURE,
        edits: [
          {
            path: 'calc.py',
            newContent:
              'def add(a, b):\n    return b + a\n\n\ndef unused_helper(a, b):\n    return a - b\n',
          },
        ],
        testCmd: 'python3 -m pytest -q test_calc.py',
      });
      const report = JSON.parse(res.content[0]!.text);
      expect(report.testScope.scope).toBe('narrowed');
      expect(report.testScope.source).toBe('override');
      expect(report.testScope.signals.join(' ')).toContain('test_calc.py');
      expect(report.verdict).not.toBe('SAFE');
    },
    180_000,
  );

  it('reports a diff-apply error as an error result, not a throw', async () => {
    const res = await handleVerifyChange({ repoRoot: FIXTURE });
    expect(res.isError).toBe(true);
  });
});
