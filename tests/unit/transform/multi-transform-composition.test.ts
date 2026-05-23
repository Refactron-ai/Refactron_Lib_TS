// tests/unit/transform/multi-transform-composition.test.ts
//
// Regression tests for the multi-transform composition bug.
//
// Bug summary: when two transforms touched the same file, each Python sidecar
// re-read the unmodified original from disk (it ignored `ctx.source`), so the
// engine's per-iteration `currentText` was overwritten by the next transform
// and only the LAST transform's rewrite survived. Worse, the engine collapsed
// the file's contributions into a single FileChange tagged with the FIRST
// transform's id, so `run --apply` silently wrote only the last transform's
// result to disk. This file pins both defects: composition AND per-transform
// FileChange emission.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { RefactronAnalyzer } from '../../../src/analyze/engine.js';
import { RefactronRefactorer } from '../../../src/transform/engine.js';

const FIXTURE = `import functools


class Greeter:
    def __init__(self, name):
        super(Greeter, self).__init__()
        self.name = name


@functools.lru_cache(maxsize=None)
def expensive(x):
    return x * x
`;

async function fixtureProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'multi-tx-'));
  await fs.writeFile(path.join(root, 'sample.py'), FIXTURE, 'utf8');
  // pyproject.toml so the analyzer recognizes a project.
  await fs.writeFile(
    path.join(root, 'pyproject.toml'),
    '[project]\nname = "multi-tx"\nrequires-python = ">=3.11"\n',
    'utf8',
  );
  return root;
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

describe('multi-transform composition on a single file', () => {
  it('emits one FileChange per touching transform, each carrying cumulative content', async () => {
    const root = await fixtureProject();
    const analyzer = new RefactronAnalyzer({ confidence: 'low' });
    const report = await analyzer.analyzeExtended(root);
    const refactorer = new RefactronRefactorer({ projectRoot: root, pythonVersion: '3.11' });
    const plan = await refactorer.plan(report, []);

    const samplePath = path.join(root, 'sample.py');
    const fileChanges = plan.changes.filter((c) => c.path === samplePath);

    // Both transforms must have produced a FileChange.
    expect(fileChanges.length).toBe(2);

    // Engine TRANSFORM_ORDER puts super_no_args before lru_cache_to_cache.
    const [first, second] = fileChanges;
    expect(first!.transformId).toBe('super_no_args');
    expect(second!.transformId).toBe('lru_cache_to_cache');

    // First FileChange: super() rewritten, lru_cache_to_cache NOT yet applied.
    expect(first!.newContent).toContain('super().__init__()');
    expect(first!.newContent).not.toContain('super(Greeter, self).__init__()');
    expect(first!.newContent).toContain('@functools.lru_cache(maxsize=None)');

    // Second FileChange: cumulative — BOTH rewrites present.
    expect(second!.newContent).toContain('super().__init__()');
    expect(second!.newContent).toContain('@functools.cache');
    expect(second!.newContent).not.toContain('@functools.lru_cache(maxsize=None)');

    // Both share the same oldHash (the true on-disk original).
    const originalHash = sha256(FIXTURE);
    expect(first!.oldHash).toBe(originalHash);
    expect(second!.oldHash).toBe(originalHash);

    await fs.rm(root, { recursive: true, force: true });
  }, 120_000);

  it('emits exactly ONE FileChange when only one transform applies — the common case stays clean', async () => {
    // Same fixture shape but only super(...) — no lru_cache pattern, so
    // only super_no_args fires.
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'single-tx-'));
    await fs.writeFile(
      path.join(root, 'sample.py'),
      `class Greeter:\n    def __init__(self, name):\n        super(Greeter, self).__init__()\n        self.name = name\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(root, 'pyproject.toml'),
      '[project]\nname = "single-tx"\nrequires-python = ">=3.11"\n',
      'utf8',
    );

    const analyzer = new RefactronAnalyzer({ confidence: 'low' });
    const report = await analyzer.analyzeExtended(root);
    const refactorer = new RefactronRefactorer({ projectRoot: root, pythonVersion: '3.11' });
    const plan = await refactorer.plan(report, []);

    const samplePath = path.join(root, 'sample.py');
    const fileChanges = plan.changes.filter((c) => c.path === samplePath);

    expect(fileChanges.length).toBe(1);
    expect(fileChanges[0]!.transformId).toBe('super_no_args');
    expect(fileChanges[0]!.newContent).toContain('super().__init__()');

    await fs.rm(root, { recursive: true, force: true });
  }, 120_000);
});
