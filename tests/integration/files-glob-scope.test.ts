// tests/integration/files-glob-scope.test.ts
//
// Pins the `--files=<glob>` scope on `run --apply`. Before the fix the glob
// only narrowed the dry-run preview formatter — the apply path silently walked
// every matching finding in the project, so `--apply --files=foo.py` would
// rewrite the entire tree. Reproduced on Ansible (issue #50).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { RefactronAnalyzer } from '../../src/analyze/engine.js';
import { RefactronRefactorer } from '../../src/transform/engine.js';
import { runApplyWithVerification } from '../../src/cli/apply-orchestrator.js';
import { matchesGlob } from '../../src/cli/format-plan.js';
import { toPosix } from '../../src/cli/format-types.js';

const PY_FIXTURE = `import functools


class Greeter:
    def __init__(self, name):
        super(Greeter, self).__init__()
        self.name = name


@functools.lru_cache(maxsize=None)
def expensive(x):
    return x * x
`;

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'files-glob-'));
  // Two .py files with super_no_args + lru_cache findings, plus a noise file
  // that has the same findings but should be filtered OUT by the glob.
  await fs.writeFile(path.join(root, 'keep.py'), PY_FIXTURE, 'utf8');
  await fs.writeFile(path.join(root, 'skip.py'), PY_FIXTURE, 'utf8');
  await fs.writeFile(
    path.join(root, 'pyproject.toml'),
    '[project]\nname = "files-glob"\nrequires-python = ">=3.11"\n',
    'utf8',
  );
  return root;
}

describe('`--files=<glob>` scope on `run --apply`', () => {
  it('filters plan.changes BEFORE apply, not just the dry-run preview', async () => {
    const root = await makeRoot();
    const keep = path.join(root, 'keep.py');
    const skip = path.join(root, 'skip.py');

    // 1) Build the full plan.
    const analyzer = new RefactronAnalyzer({ confidence: 'low' });
    const report = await analyzer.analyzeExtended(root);
    const refactorer = new RefactronRefactorer({ projectRoot: root, pythonVersion: '3.11' });
    const plan = await refactorer.plan(report, []);

    // Sanity: without the glob, both files would be rewritten.
    const allPaths = new Set(plan.changes.map((c) => c.path));
    expect(allPaths.has(keep)).toBe(true);
    expect(allPaths.has(skip)).toBe(true);

    // 2) Apply the same filter run-command.ts applies after the user passes
    //    `--files=keep.py`. The filter is the inlined version of what main()
    //    runs — the integration is that BOTH dry-run AND apply see the same
    //    filtered set, instead of just the dry-run formatter.
    const glob = 'keep.py';
    plan.changes = plan.changes.filter((c) => {
      const rel = toPosix(path.relative(root, c.path));
      return matchesGlob(rel, glob) || matchesGlob(toPosix(c.path), glob);
    });
    expect(plan.changes.length).toBeGreaterThan(0);
    for (const c of plan.changes) expect(c.path).toBe(keep);

    // 3) Apply: only keep.py should land on disk; skip.py untouched.
    const { outcome } = await runApplyWithVerification(
      plan,
      root,
      { line: (): void => undefined },
      { signal: new AbortController().signal, testCmd: 'true' },
    );
    expect(outcome).toBe('all');

    const afterKeep = await fs.readFile(keep, 'utf8');
    const afterSkip = await fs.readFile(skip, 'utf8');
    expect(afterKeep).not.toBe(PY_FIXTURE); // rewritten
    expect(afterSkip).toBe(PY_FIXTURE); // untouched
  });
});
