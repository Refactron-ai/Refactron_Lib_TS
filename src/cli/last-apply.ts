// src/cli/last-apply.ts
// Persist a snapshot of the most recent successful `run --apply` so downstream
// commands (notably `document`) can rebuild the pre-write originals map after
// the verifier's writes have hit disk.
//
// Failures during load are silently coerced to null: a missing or malformed
// snapshot must never break the CLI session.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { FileChange, TransformId } from '../contracts.js';

export interface LastApplySnapshot {
  projectRoot: string;
  verifiedAt: string;
  changes: Array<{
    path: string;
    oldContent: string;
    newContent: string;
    transformId: TransformId;
  }>;
}

function snapshotPath(projectRoot: string): string {
  return path.join(projectRoot, '.refactron', 'last-apply.json');
}

export async function persistLastApply(snapshot: LastApplySnapshot): Promise<void> {
  const file = snapshotPath(snapshot.projectRoot);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(snapshot, null, 2), 'utf8');
}

export async function loadLastApply(projectRoot: string): Promise<LastApplySnapshot | null> {
  try {
    const raw = await fs.readFile(snapshotPath(projectRoot), 'utf8');
    return JSON.parse(raw) as LastApplySnapshot;
  } catch {
    return null;
  }
}

/**
 * Collapse FileChanges to one record per path. The engine emits one
 * FileChange per touching transform; `last-apply` and the rollback journal
 * only need one record per file (rollback restores `oldContent`, not a
 * transform-by-transform replay). The record's `newContent` is taken from
 * the LAST FileChange per path — the cumulative composition that hit disk.
 * The `transformId` is the FIRST touching transform's id, which is what the
 * locked FileChange shape forces us to pick a single value for.
 */
export function collapseChangesByPath(
  changes: readonly FileChange[],
  originals: ReadonlyMap<string, string>,
): LastApplySnapshot['changes'] {
  const map = new Map<string, LastApplySnapshot['changes'][number]>();
  const order: string[] = [];
  for (const c of changes) {
    const existing = map.get(c.path);
    if (existing) {
      // Keep the first transformId we saw (engine order), but advance
      // newContent to the latest cumulative version.
      existing.newContent = c.newContent;
    } else {
      const oldContent = originals.get(c.path);
      if (oldContent === undefined) {
        // Defensive: every applied path must have its pre-write original
        // captured for rollback. Silently storing `""` here would cause
        // `rollback` to "restore" an EMPTY file — silent data loss worse
        // than a no-op. Loudly fail so the caller can surface it.
        throw new Error(
          `last-apply: cannot record rollback for ${c.path} — pre-write original content was unavailable`,
        );
      }
      map.set(c.path, {
        path: c.path,
        oldContent,
        newContent: c.newContent,
        transformId: c.transformId,
      });
      order.push(c.path);
    }
  }
  return order.map((p) => map.get(p)!);
}
