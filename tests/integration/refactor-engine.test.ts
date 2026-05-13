// tests/integration/refactor-engine.test.ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { RefactronAnalyzer } from '../../src/analyze/engine.js';
import { RefactronRefactorer } from '../../src/transform/engine.js';

const PY = path.resolve('fixtures/python-legacy-mini');

async function copyFixture(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'refactor-int-'));
  await fs.cp(PY, dir, { recursive: true });
  return dir;
}

describe('RefactronRefactorer + RefactronAnalyzer on python-legacy-mini', () => {
  it('produces a RefactorPlan with at least one FileChange per detected pattern', async () => {
    const root = await copyFixture();
    const analyzer = new RefactronAnalyzer({ confidence: 'low' });
    const report = await analyzer.analyzeExtended(root);
    const refactorer = new RefactronRefactorer({ projectRoot: root });
    const plan = await refactorer.plan(report, []);
    expect(plan.changes.length).toBeGreaterThan(0);
    for (const c of plan.changes) {
      const orig = await fs.readFile(c.path, 'utf8');
      expect(c.newContent).not.toBe(orig);
    }
  }, 120_000);

  it('records preconditions even when transforms skip', async () => {
    const root = await copyFixture();
    const analyzer = new RefactronAnalyzer({ confidence: 'low' });
    const report = await analyzer.analyzeExtended(root);
    const refactorer = new RefactronRefactorer({ projectRoot: root });
    const plan = await refactorer.plan(report, []);
    expect(plan.preconditions.length).toBeGreaterThan(0);
  }, 120_000);
});
