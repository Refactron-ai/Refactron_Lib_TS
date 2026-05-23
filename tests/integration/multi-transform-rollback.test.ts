// tests/integration/multi-transform-rollback.test.ts
//
// Pins the rollback behavior for a file touched by multiple transforms in a
// single `run --apply`. The journal must hold ONE entry per file (not one per
// touching transform), so rolling back restores the true on-disk original.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { RefactronAnalyzer } from '../../src/analyze/engine.js';
import { RefactronRefactorer } from '../../src/transform/engine.js';
import { runApplyWithVerification } from '../../src/cli/apply-orchestrator.js';
import { collapseChangesByPath, persistLastApply } from '../../src/cli/last-apply.js';
import { appendJournalEntry, listJournalEntries } from '../../src/cli/journal.js';
import { runRollbackCommand } from '../../src/cli/rollback-command.js';

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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'multi-tx-rb-'));
  await fs.writeFile(path.join(root, 'sample.py'), FIXTURE, 'utf8');
  await fs.writeFile(
    path.join(root, 'pyproject.toml'),
    '[project]\nname = "multi-tx"\nrequires-python = ">=3.11"\n',
    'utf8',
  );
  return root;
}

describe('rollback after multi-transform apply on a single file', () => {
  it('restores the true original after both transforms — one journal entry per file', async () => {
    const root = await fixtureProject();
    const samplePath = path.join(root, 'sample.py');
    const originals = new Map<string, string>([[samplePath, FIXTURE]]);

    // 1) Plan + apply two transforms on the same file.
    const analyzer = new RefactronAnalyzer({ confidence: 'low' });
    const report = await analyzer.analyzeExtended(root);
    const refactorer = new RefactronRefactorer({ projectRoot: root, pythonVersion: '3.11' });
    const plan = await refactorer.plan(report, []);

    const { appliedChanges, outcome } = await runApplyWithVerification(
      plan,
      root,
      { line: (): void => undefined },
      { signal: new AbortController().signal, testCmd: 'true' },
    );
    expect(outcome).toBe('all');

    // 2) Persist last-apply + journal using the same collapse helper that
    //    run-command / runner use after apply. The collapse MUST yield one
    //    record per path so rollback restores `oldContent` cleanly.
    const collapsed = collapseChangesByPath(appliedChanges, originals);
    expect(collapsed.length).toBe(1);
    expect(collapsed[0]!.oldContent).toBe(FIXTURE);
    // The collapsed `newContent` is the cumulative on-disk content.
    const onDiskAfterApply = await fs.readFile(samplePath, 'utf8');
    expect(collapsed[0]!.newContent).toBe(onDiskAfterApply);

    await persistLastApply({
      projectRoot: root,
      verifiedAt: new Date().toISOString(),
      changes: collapsed,
    });
    await appendJournalEntry(
      root,
      'apply',
      'run --apply',
      collapsed.map((c) => ({ path: c.path, before: c.oldContent, after: c.newContent })),
    );

    // Journal must have one file record, NOT two (one per transform).
    const journal = await listJournalEntries(root);
    expect(journal.length).toBe(1);
    expect(journal[0]!.entry.files.length).toBe(1);
    expect(journal[0]!.entry.files[0]!.path).toBe(samplePath);
    expect(journal[0]!.entry.files[0]!.before).toBe(FIXTURE);

    // 3) Rollback must restore the file to its true original.
    const out: string[] = [];
    const code = await runRollbackCommand([root], { out: (t: string): void => void out.push(t) });
    expect(code).toBe(0);
    expect(await fs.readFile(samplePath, 'utf8')).toBe(FIXTURE);

    await fs.rm(root, { recursive: true, force: true });
  }, 180_000);
});
