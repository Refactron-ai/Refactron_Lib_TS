// src/cli/rollback-command.ts
// `refactron rollback` — undo what `run --apply` / `document --apply` wrote.
//
// Reverts the most recent journal entry (LIFO); `--all` reverts every entry.
// Drift-safe: if a file changed since the operation, rollback aborts rather
// than silently discard those edits (override with `--force`).
//
// Exit codes:
//   0  success (or nothing to roll back, or --dry-run)
//   1  blocked by drift (without --force) / bad flags
//   2  internal error

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { atomicWrite } from '../verification/atomic-writer.js';
import {
  listJournalEntries,
  removeJournalEntry,
  type JournalEntry,
  type StoredJournalEntry,
} from './journal.js';

export type RollbackOutputSink = (text: string, stream: 'stdout' | 'stderr') => void;

const defaultSink: RollbackOutputSink = (text, stream) => {
  if (stream === 'stderr') process.stderr.write(text);
  else process.stdout.write(text);
};

export interface RunRollbackDeps {
  out?: RollbackOutputSink;
}

interface RollbackFlags {
  target: string;
  all: boolean;
  force: boolean;
  dryRun: boolean;
}

class RollbackFlagError extends Error {}

function parseFlags(argv: string[]): RollbackFlags {
  let target: string | null = null;
  let all = false;
  let force = false;
  let dryRun = false;
  for (const a of argv) {
    if (a === '--all') {
      all = true;
    } else if (a === '--force') {
      force = true;
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a.startsWith('-')) {
      throw new RollbackFlagError(`unknown flag: ${a}`);
    } else if (target !== null) {
      throw new RollbackFlagError(`unexpected extra argument: ${a}`);
    } else {
      target = a;
    }
  }
  return { target: target ?? '.', all, force, dryRun };
}

interface RevertPlan {
  /** path → content to restore. */
  restores: Map<string, string>;
  /** paths the operation created — to delete. */
  deletes: Set<string>;
  /** path → content expected on disk now (drift baseline). */
  baseline: Map<string, string>;
}

/**
 * Combine the selected entries (newest-first) into a single revert plan: each
 * file's drift baseline is the newest `after`, its revert target the oldest
 * `before`.
 */
export function computeRevert(selectedNewestFirst: JournalEntry[]): RevertPlan {
  const baseline = new Map<string, string>();
  const target = new Map<string, string | null>();
  for (const entry of selectedNewestFirst) {
    for (const fc of entry.files) {
      if (!baseline.has(fc.path)) baseline.set(fc.path, fc.after);
      target.set(fc.path, fc.before); // oldest entry wins (iterated newest→oldest)
    }
  }
  const restores = new Map<string, string>();
  const deletes = new Set<string>();
  for (const [p, t] of target) {
    if (t === null) deletes.add(p);
    else restores.set(p, t);
  }
  return { restores, deletes, baseline };
}

/** Remove now-empty ancestor directories of deleted files, up to projectRoot. */
async function pruneEmptyDirs(deleted: Set<string>, projectRoot: string): Promise<void> {
  const root = path.resolve(projectRoot);
  for (const file of deleted) {
    let dir = path.dirname(path.resolve(file));
    while (dir.startsWith(root) && dir !== root) {
      try {
        await fs.rmdir(dir); // fails (and stops) if the dir is not empty
      } catch {
        break;
      }
      dir = path.dirname(dir);
    }
  }
}

export async function runRollbackCommand(
  argv: string[],
  deps: RunRollbackDeps = {},
): Promise<number> {
  const out = deps.out ?? defaultSink;
  let flags: RollbackFlags;
  try {
    flags = parseFlags(argv);
  } catch (err) {
    if (err instanceof RollbackFlagError) {
      out(`refactron rollback: ${err.message}\n`, 'stderr');
      return 1;
    }
    throw err;
  }

  const projectRoot = path.resolve(flags.target);
  const stored = await listJournalEntries(projectRoot);
  if (stored.length === 0) {
    out('refactron rollback: nothing to roll back — no Refactron operations recorded.\n', 'stdout');
    return 0;
  }

  const selected: StoredJournalEntry[] = flags.all ? stored : [stored[0]!];
  const plan = computeRevert(selected.map((s) => s.entry));

  // ── Drift check ────────────────────────────────────────────────────────────
  const drifted: string[] = [];
  for (const [p, expected] of plan.baseline) {
    let current: string | null;
    try {
      current = await fs.readFile(p, 'utf8');
    } catch {
      current = null;
    }
    if (current !== expected) drifted.push(p);
  }
  if (drifted.length > 0 && !flags.force) {
    out(
      'refactron rollback: blocked — these files changed since the operation:\n' +
        drifted.map((p) => `  · ${path.relative(projectRoot, p) || p}\n`).join('') +
        'Rolling back would discard those edits. Re-run with --force to override.\n',
      'stderr',
    );
    return 1;
  }

  const restoreList = [...plan.restores.entries()];
  const deleteList = [...plan.deletes];
  const rel = (p: string): string => path.relative(projectRoot, p) || p;

  // ── Dry run ────────────────────────────────────────────────────────────────
  if (flags.dryRun) {
    out(`refactron rollback (dry run): would revert ${selected.length} operation(s)\n`, 'stdout');
    for (const [p] of restoreList) out(`  restore  ${rel(p)}\n`, 'stdout');
    for (const p of deleteList) out(`  delete   ${rel(p)}\n`, 'stdout');
    if (drifted.length > 0)
      out(`  (--force would discard edits in ${drifted.length} file(s))\n`, 'stdout');
    return 0;
  }

  // ── Apply the revert ───────────────────────────────────────────────────────
  try {
    for (const [p, content] of restoreList) {
      await fs.mkdir(path.dirname(p), { recursive: true });
      await atomicWrite(p, content);
    }
    for (const p of deleteList) {
      await fs.rm(p, { force: true });
    }
    await pruneEmptyDirs(plan.deletes, projectRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    out(`refactron rollback: failed while restoring files: ${msg}\n`, 'stderr');
    return 2;
  }

  // ── Journal cleanup ────────────────────────────────────────────────────────
  let revertedApply = false;
  for (const s of selected) {
    await removeJournalEntry(projectRoot, s.file);
    if (s.entry.command === 'apply') revertedApply = true;
  }
  // A reverted apply makes last-apply.json stale — drop it so a later
  // `document` can't read an operation that no longer happened.
  if (revertedApply) {
    await fs.rm(path.join(projectRoot, '.refactron', 'last-apply.json'), { force: true });
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const labels = selected.map((s) => s.entry.label).join(', ');
  out(
    `refactron rollback: reverted ${selected.length} operation(s) — ${labels}\n` +
      `  restored ${restoreList.length} file(s)` +
      (deleteList.length > 0 ? `, removed ${deleteList.length} file(s)` : '') +
      '\n',
    'stdout',
  );
  const remaining = stored.length - selected.length;
  if (remaining > 0) {
    out(
      `  ${remaining} earlier operation(s) still applied — ` +
        '`rollback` again to undo the next, or `rollback --all`.\n',
      'stdout',
    );
  }
  return 0;
}
