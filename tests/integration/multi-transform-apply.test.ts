// tests/integration/multi-transform-apply.test.ts
//
// Pins the on-disk outcome of `run --apply` when two transforms touch the
// same file. Before the multi-transform fix, only the LAST transform's
// rewrite hit disk — see tests/unit/transform/multi-transform-composition.test.ts
// for the engine-side defect and runner.runPythonTransformWithSource for the
// data-loss root cause.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { RefactronAnalyzer } from '../../src/analyze/engine.js';
import { RefactronRefactorer } from '../../src/transform/engine.js';
import { runApplyWithVerification } from '../../src/cli/apply-orchestrator.js';

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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'multi-tx-apply-'));
  await fs.writeFile(path.join(root, 'sample.py'), FIXTURE, 'utf8');
  await fs.writeFile(
    path.join(root, 'pyproject.toml'),
    '[project]\nname = "multi-tx"\nrequires-python = ">=3.11"\n',
    'utf8',
  );
  return root;
}

describe('runApplyWithVerification — multi-transform per file', () => {
  it('writes the cumulative content of every transform exactly once per file', async () => {
    const root = await fixtureProject();
    const analyzer = new RefactronAnalyzer({ confidence: 'low' });
    const report = await analyzer.analyzeExtended(root);
    const refactorer = new RefactronRefactorer({ projectRoot: root, pythonVersion: '3.11' });
    const plan = await refactorer.plan(report, []);

    const samplePath = path.join(root, 'sample.py');
    // Sanity: engine emitted multiple FileChanges for the file (one per
    // touching transform) — the orchestrator must dedupe per path.
    expect(plan.changes.filter((c) => c.path === samplePath).length).toBe(2);

    // Count how many times the tests gate ran. With `testCmd: 'true'` each
    // invocation is essentially free, but the count itself is the contract:
    // batch verifies once across both transforms (NOT once per transform).
    let testGateRuns = 0;
    const lines: string[] = [];
    const result = await runApplyWithVerification(
      plan,
      root,
      {
        line: (text: string): void => {
          lines.push(text);
          // The orchestrator's onGateComplete + the "applying N file(s) …"
          // lines are emitted via formatGateProgress. Counting "tests" gate
          // lines is a stable proxy for "how many times did testsGate run?".
          if (/^\s*✔.*\btests\b/.test(text)) testGateRuns += 1;
        },
      },
      { signal: new AbortController().signal, testCmd: 'true' },
    );

    expect(result.outcome).toBe('all');

    // Tests gate ran exactly once for the batch (not twice — once per
    // transform). The per-file fallback was not triggered because the batch
    // passed.
    expect(testGateRuns).toBe(1);

    // On-disk: BOTH rewrites must be present.
    const onDisk = await fs.readFile(samplePath, 'utf8');
    expect(onDisk).toContain('super().__init__()');
    expect(onDisk).not.toContain('super(Greeter, self).__init__()');
    expect(onDisk).toContain('@functools.cache');
    expect(onDisk).not.toContain('@functools.lru_cache(maxsize=None)');

    await fs.rm(root, { recursive: true, force: true });
  }, 180_000);
});
