// src/cli/last-apply.ts
// Persist a snapshot of the most recent successful `run --apply` so downstream
// commands (notably `document`) can rebuild the pre-write originals map after
// the verifier's writes have hit disk.
//
// Failures during load are silently coerced to null: a missing or malformed
// snapshot must never break the CLI session.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { TransformId } from '../contracts.js';

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
