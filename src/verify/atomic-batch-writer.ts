import writeAtomic from 'write-file-atomic';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { FileChange } from '../contracts.js';

/**
 * Two-phase batch write.
 *
 * Phase 1: write every new content to a sibling temp file (write-file-atomic fsyncs internally).
 * Phase 2: rename each temp into place. On any failure we unlink surviving temps; already-renamed
 *          files are NOT rolled back because write-file-atomic guarantees the prior content was
 *          replaced as a single atomic step.
 *
 * Preflight: every target's parent directory must already exist. If any parent is missing we
 * fail BEFORE any write.
 */
export async function writeBatchAtomic(changes: FileChange[]): Promise<void> {
  // Preflight: parent dirs must exist for every target.
  await Promise.all(
    changes.map(async (c) => {
      const parent = path.dirname(c.path);
      try {
        await fs.access(parent);
      } catch {
        throw new Error(`atomic batch write: parent dir missing for ${c.path}`);
      }
    }),
  );

  const tempPaths: string[] = [];
  try {
    for (const c of changes) {
      const tmp = `${c.path}.refactron-${crypto.randomBytes(6).toString('hex')}`;
      await writeAtomic(tmp, c.newContent);
      tempPaths.push(tmp);
    }
    // Phase 2: rename each temp into place.
    for (let i = 0; i < changes.length; i++) {
      const tmp = tempPaths[i];
      const target = changes[i];
      if (tmp === undefined || target === undefined) continue;
      await fs.rename(tmp, target.path);
      tempPaths[i] = '';
    }
  } catch (err) {
    await Promise.all(
      tempPaths.filter((p) => p.length > 0).map((p) => fs.unlink(p).catch(() => undefined)),
    );
    throw err;
  }
}
