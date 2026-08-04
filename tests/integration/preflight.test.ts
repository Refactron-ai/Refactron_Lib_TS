import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RefactronAnalyzer } from '../../src/analyze/engine.js';
import { buildSafetyReport } from '../../src/analyze/safety/verdict.js';
import type { TransformId } from '../../src/contracts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '../fixtures/sqlalchemy-mini');

function pythonHasCoverage(): boolean {
  try {
    execSync('python3 -c "import coverage, pytest"', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// The ninth early return. It reported PASSED while asserting nothing, and this
// is the highest-value instance in the directory: the assertions below are
// `coverageAvailable === true` and at least one safe-to-automate site, so on an
// image without coverage.py the whole preflight safety report went green
// without running.
const NO_COVERAGE = !pythonHasCoverage();

describe('preflight integration (sqlalchemy-mini)', () => {
  it.skipIf(NO_COVERAGE)(
    'splits covered vs uncovered query sites into safe-to-automate vs unproven',
    async () => {
      const analyzer = new RefactronAnalyzer({
        confidence: 'medium',
        transforms: ['sqlalchemy_query_to_select'] as unknown as TransformId[],
      });
      const report = await analyzer.analyzeExtended(FIXTURE);
      const sql = report.findings.filter(
        (f) => (f.transformId as string) === 'sqlalchemy_query_to_select',
      );
      const safety = buildSafetyReport(FIXTURE, 'sqlalchemy_query_to_select', sql);

      expect(safety.coverageAvailable).toBe(true);
      // Both queries are `safe` shape; tested_query is covered, untested_query is not.
      expect(safety.counts['safe-to-automate']).toBeGreaterThanOrEqual(1);
      expect(safety.counts.unproven).toBeGreaterThanOrEqual(1);
      expect(safety.total).toBe(
        safety.counts['safe-to-automate'] + safety.counts.unproven + safety.counts['needs-review'],
      );
    },
    30000,
  );
});
