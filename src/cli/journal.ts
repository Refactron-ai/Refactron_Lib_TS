// src/cli/journal.ts
// The operation journal — a LIFO record of what `run --apply` and
// `document --apply` wrote to disk, so `rollback` can undo them.
//
// One JSON file per entry under `.refactron/journal/`, named
// `<epochMillis>-<rand>.json` so the filename sorts chronologically.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

/** One file touched by an operation. `before: null` means the file did not
 *  exist beforehand (the operation created it — a revert deletes it). */
export interface JournalFileChange {
  path: string;
  before: string | null;
  /** Content the operation left on disk — the drift baseline for rollback. */
  after: string;
  /** File mode (low 9 bits, e.g. 0o755) at apply time. Omitted on older
   *  journals; `null` when the file did not exist beforehand. */
  mode?: number | null;
}

export interface JournalEntry {
  id: string;
  timestamp: string;
  command: 'apply' | 'document';
  /** Short human description, shown in the rollback summary. */
  label: string;
  files: JournalFileChange[];
}

/** A journal entry paired with the basename of the file that holds it. */
export interface StoredJournalEntry {
  file: string;
  entry: JournalEntry;
}

function journalDir(projectRoot: string): string {
  return path.join(projectRoot, '.refactron', 'journal');
}

/** Append an entry to the journal. Generates the entry id + filename. */
export async function appendJournalEntry(
  projectRoot: string,
  command: JournalEntry['command'],
  label: string,
  files: JournalFileChange[],
): Promise<void> {
  const dir = journalDir(projectRoot);
  await fs.mkdir(dir, { recursive: true });
  const now = Date.now();
  const id = randomBytes(4).toString('hex');
  const entry: JournalEntry = {
    id,
    timestamp: new Date(now).toISOString(),
    command,
    label,
    files,
  };
  const fileName = `${String(now).padStart(15, '0')}-${id}.json`;
  await fs.writeFile(path.join(dir, fileName), JSON.stringify(entry, null, 2), 'utf8');
}

function isJournalEntry(value: unknown): value is JournalEntry {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.timestamp === 'string' &&
    (o.command === 'apply' || o.command === 'document') &&
    typeof o.label === 'string' &&
    Array.isArray(o.files)
  );
}

/** All journal entries, newest first. Malformed files are skipped. */
export async function listJournalEntries(projectRoot: string): Promise<StoredJournalEntry[]> {
  const dir = journalDir(projectRoot);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: StoredJournalEntry[] = [];
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
      if (isJournalEntry(parsed)) out.push({ file: name, entry: parsed });
    } catch {
      // skip malformed entry
    }
  }
  return out.reverse(); // newest first
}

/** Remove a journal entry file after its operation has been reverted. */
export async function removeJournalEntry(projectRoot: string, file: string): Promise<void> {
  await fs.rm(path.join(journalDir(projectRoot), file), { force: true });
}
