import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { computeRevert, runRollbackCommand } from '../../../src/cli/rollback-command.js';
import { appendJournalEntry } from '../../../src/cli/journal.js';
import type { JournalEntry } from '../../../src/cli/journal.js';

// POSIX file modes are a no-op on NTFS — the mode-preservation round-trip
// only works on POSIX filesystems. Skip on Windows.
const itPosix = process.platform === 'win32' ? it.skip : it;

const tmp: string[] = [];
afterEach(async () => {
  for (const d of tmp.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

async function root(): Promise<string> {
  const r = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-'));
  tmp.push(r);
  return r;
}

function entry(files: JournalEntry['files']): JournalEntry {
  return { id: 'x', timestamp: '', command: 'apply', label: 'op', files };
}

/** Capture sink + the exit code from a rollback run. */
async function rollback(args: string[]): Promise<{ code: number; text: string }> {
  const lines: string[] = [];
  const code = await runRollbackCommand(args, {
    out: (t) => lines.push(t),
  });
  return { code, text: lines.join('') };
}

describe('computeRevert', () => {
  it('restores `before` and uses `after` as the drift baseline', () => {
    const plan = computeRevert([entry([{ path: '/p/a', before: 'old', after: 'new' }])]);
    expect(plan.restores.get('/p/a')?.content).toBe('old');
    expect(plan.baseline.get('/p/a')).toBe('new');
    expect(plan.deletes.size).toBe(0);
  });

  it('marks a file the operation created (before:null) for deletion', () => {
    const plan = computeRevert([entry([{ path: '/p/new', before: null, after: 'created' }])]);
    expect(plan.deletes.has('/p/new')).toBe(true);
    expect(plan.restores.has('/p/new')).toBe(false);
  });

  it('across entries, restores the oldest `before` and baselines the newest `after`', () => {
    // newest-first: doc entry then apply entry, same file.
    const plan = computeRevert([
      entry([{ path: '/p/a', before: 'refactored', after: 'documented' }]),
      entry([{ path: '/p/a', before: 'original', after: 'refactored' }]),
    ]);
    expect(plan.restores.get('/p/a')?.content).toBe('original');
    expect(plan.baseline.get('/p/a')).toBe('documented');
  });
});

describe('runRollbackCommand', () => {
  it('reports nothing to roll back on an empty journal', async () => {
    const r = await root();
    const { code, text } = await rollback([r]);
    expect(code).toBe(0);
    expect(text).toMatch(/nothing to roll back/i);
  });

  it('reverts the most recent operation, restoring file content', async () => {
    const r = await root();
    const f = path.join(r, 'a.py');
    await fs.writeFile(f, 'NEW\n');
    await appendJournalEntry(r, 'apply', 'op', [{ path: f, before: 'OLD\n', after: 'NEW\n' }]);
    const { code } = await rollback([r]);
    expect(code).toBe(0);
    expect(await fs.readFile(f, 'utf8')).toBe('OLD\n');
  });

  it('deletes a file the operation created', async () => {
    const r = await root();
    const f = path.join(r, 'created.md');
    await fs.writeFile(f, 'GENERATED\n');
    await appendJournalEntry(r, 'document', 'op', [
      { path: f, before: null, after: 'GENERATED\n' },
    ]);
    const { code } = await rollback([r]);
    expect(code).toBe(0);
    await expect(fs.access(f)).rejects.toThrow();
  });

  it('blocks on drift unless --force', async () => {
    const r = await root();
    const f = path.join(r, 'a.py');
    await fs.writeFile(f, 'HAND-EDITED\n'); // differs from journal `after`
    await appendJournalEntry(r, 'apply', 'op', [{ path: f, before: 'OLD\n', after: 'NEW\n' }]);

    const blocked = await rollback([r]);
    expect(blocked.code).toBe(1);
    expect(blocked.text).toMatch(/blocked/i);
    expect(await fs.readFile(f, 'utf8')).toBe('HAND-EDITED\n'); // untouched

    const forced = await rollback([r, '--force']);
    expect(forced.code).toBe(0);
    expect(await fs.readFile(f, 'utf8')).toBe('OLD\n');
  });

  it('--dry-run previews without writing', async () => {
    const r = await root();
    const f = path.join(r, 'a.py');
    await fs.writeFile(f, 'NEW\n');
    await appendJournalEntry(r, 'apply', 'op', [{ path: f, before: 'OLD\n', after: 'NEW\n' }]);
    const { code, text } = await rollback([r, '--dry-run']);
    expect(code).toBe(0);
    expect(text).toMatch(/dry run/i);
    expect(await fs.readFile(f, 'utf8')).toBe('NEW\n'); // unchanged
  });

  itPosix('restores the original file mode, not just content', async () => {
    const r = await root();
    const f = path.join(r, 'script.sh');
    // Simulate post-apply state: content is the journal's `after`, mode lost.
    await fs.writeFile(f, 'NEW\n');
    await fs.chmod(f, 0o644);
    await appendJournalEntry(r, 'apply', 'op', [
      { path: f, before: '#!/bin/sh\n', after: 'NEW\n', mode: 0o755 },
    ]);
    const { code } = await rollback([r]);
    expect(code).toBe(0);
    expect(await fs.readFile(f, 'utf8')).toBe('#!/bin/sh\n');
    expect((await fs.stat(f)).mode & 0o777).toBe(0o755);
  });

  it('--all reverts every operation in one pass', async () => {
    const r = await root();
    const f = path.join(r, 'a.py');
    await fs.writeFile(f, 'documented\n');
    await appendJournalEntry(r, 'apply', 'apply op', [
      { path: f, before: 'original\n', after: 'refactored\n' },
    ]);
    await new Promise((res) => setTimeout(res, 5));
    await appendJournalEntry(r, 'document', 'document op', [
      { path: f, before: 'refactored\n', after: 'documented\n' },
    ]);
    const { code } = await rollback([r, '--all']);
    expect(code).toBe(0);
    expect(await fs.readFile(f, 'utf8')).toBe('original\n');
  });
});
