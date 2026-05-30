import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  appendJournalEntry,
  listJournalEntries,
  removeJournalEntry,
} from '../../../src/cli/journal.js';

const tmp: string[] = [];
afterEach(async () => {
  for (const d of tmp.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

async function root(): Promise<string> {
  const r = await fs.mkdtemp(path.join(os.tmpdir(), 'jrnl-'));
  tmp.push(r);
  return r;
}

describe('journal', () => {
  it('appends an entry and lists it back', async () => {
    const r = await root();
    await appendJournalEntry(r, 'apply', 'run --apply — 1 file(s)', [
      { path: '/p/a.py', before: 'old', after: 'new' },
    ]);
    const list = await listJournalEntries(r);
    expect(list).toHaveLength(1);
    expect(list[0]?.entry.command).toBe('apply');
    expect(list[0]?.entry.label).toBe('run --apply — 1 file(s)');
    expect(list[0]?.entry.files[0]?.before).toBe('old');
  });

  it('lists entries newest-first', async () => {
    const r = await root();
    await appendJournalEntry(r, 'apply', 'first', []);
    await new Promise((res) => setTimeout(res, 5));
    await appendJournalEntry(r, 'document', 'second', []);
    const list = await listJournalEntries(r);
    expect(list.map((s) => s.entry.label)).toEqual(['second', 'first']);
  });

  it('skips a malformed journal file', async () => {
    const r = await root();
    await appendJournalEntry(r, 'apply', 'good', []);
    await fs.writeFile(path.join(r, '.refactron', 'journal', '999-bad.json'), 'not json');
    const list = await listJournalEntries(r);
    expect(list).toHaveLength(1);
    expect(list[0]?.entry.label).toBe('good');
  });

  it('removes an entry', async () => {
    const r = await root();
    await appendJournalEntry(r, 'apply', 'gone', []);
    const [stored] = await listJournalEntries(r);
    await removeJournalEntry(r, stored!.file);
    expect(await listJournalEntries(r)).toHaveLength(0);
  });

  it('returns [] when no journal directory exists', async () => {
    const r = await root();
    expect(await listJournalEntries(r)).toEqual([]);
  });

  it('round-trips an optional mode field on a journal entry', async () => {
    const r = await root();
    await appendJournalEntry(r, 'apply', 'op', [
      { path: '/p/a.py', before: 'old', after: 'new', mode: 0o755 },
    ]);
    const [stored] = await listJournalEntries(r);
    expect(stored?.entry.files[0]?.mode).toBe(0o755);
  });
});
