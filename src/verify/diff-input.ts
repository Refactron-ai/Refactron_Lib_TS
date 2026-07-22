// src/verify/diff-input.ts
// Turn a change (given as {path,newContent}[] or a unified/git diff) into the
// FileEdit[] the verify pipeline consumes, and derive which new-file lines
// changed (for coverage fusion). Uses the `diff` package — no hand-rolled hunks.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { applyPatch, parsePatch, structuredPatch, type ParsedDiff } from 'diff';

export interface FileEdit {
  path: string; // repo-relative
  newContent: string; // full file content
}

export interface ChangedRange {
  path: string;
  lines: number[]; // 1-indexed new-file line numbers that were added/changed
}

export class DiffApplyError extends Error {}

/** Strip a leading `a/` or `b/` git prefix. */
function stripPrefix(p: string): string {
  return p.replace(/^[ab]\//, '');
}

// v1 verify models CONTENT edits only. Deletions, renames, and binary changes
// are not verifiable through the shadow-tree + coverage pipeline, so they must
// be REJECTED loudly rather than silently dropped: a diff that deletes a module
// yet also makes one benign edit once verified SAFE while `git apply` of the
// same diff ImportError'd the whole package. Full deletion/rename support is a
// later feature; until then honesty beats a partial verdict.
//
// Detection is belt-and-braces on purpose. parsePatch models a deletion as
// newFileName `/dev/null` and a content-carrying rename as old !== new, but it
// DROPS a pure 100%-similarity rename (no hunks) and can elide metadata-only
// entries entirely. So we also raw-scan the diff text for the git headers
// `deleted file mode`, `rename from `/`rename to `, and the binary markers —
// either source firing is enough to refuse.

interface RawDiffSignals {
  deletions: string[]; // repo-relative paths of deleted files
  renames: Array<{ from: string; to: string }>;
  copies: Array<{ from: string; to: string }>;
  hasBinary: boolean;
}

function scanRawDiff(diffStr: string): RawDiffSignals {
  const deletions: string[] = [];
  const renames: Array<{ from: string; to: string }> = [];
  const copies: Array<{ from: string; to: string }> = [];
  let hasBinary = false;
  let headerOldPath: string | null = null;
  let pendingRenameFrom: string | null = null;
  let pendingCopyFrom: string | null = null;

  for (const line of diffStr.split('\n')) {
    // git quotes header paths containing spaces/tabs/non-ASCII; match both forms.
    const gitHeader =
      /^diff --git a\/(.+?) b\/(.+)$/.exec(line) ?? /^diff --git "a\/(.+?)" "b\/(.+)"$/.exec(line);
    if (gitHeader) {
      headerOldPath = gitHeader[1] ?? null;
      pendingRenameFrom = null;
      pendingCopyFrom = null;
      continue;
    }
    if (line.startsWith('deleted file mode')) {
      // The marker alone is proof of a deletion. Never gate the refusal on
      // having parsed the header path: an EMPTY-file deletion has no hunks and
      // no `+++ /dev/null`, so this line may be the only signal there is.
      deletions.push(headerOldPath ?? '(path unresolved)');
      continue;
    }
    const renameFrom = /^rename from (.+)$/.exec(line);
    if (renameFrom) {
      pendingRenameFrom = renameFrom[1] ?? null;
      continue;
    }
    const renameTo = /^rename to (.+)$/.exec(line);
    if (renameTo && pendingRenameFrom) {
      renames.push({ from: pendingRenameFrom, to: renameTo[1] ?? '' });
      pendingRenameFrom = null;
      continue;
    }
    const copyFrom = /^copy from (.+)$/.exec(line);
    if (copyFrom) {
      pendingCopyFrom = copyFrom[1] ?? null;
      continue;
    }
    const copyTo = /^copy to (.+)$/.exec(line);
    if (copyTo && pendingCopyFrom) {
      copies.push({ from: pendingCopyFrom, to: copyTo[1] ?? '' });
      pendingCopyFrom = null;
      continue;
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      hasBinary = true;
    }
  }
  return { deletions, renames, copies, hasBinary };
}

/** The deleted path if this diff deletes a file (parsePatch or raw), else null. */
function findDeletion(patches: ParsedDiff[], raw: RawDiffSignals): string | null {
  for (const p of patches) {
    const oldRel = stripPrefix(p.oldFileName ?? '');
    const newRel = stripPrefix(p.newFileName ?? '');
    if (newRel === '/dev/null' && oldRel && oldRel !== '/dev/null') return oldRel;
  }
  return raw.deletions[0] ?? null;
}

/** The {from,to} if this diff renames a file (parsePatch or raw), else null. */
function findRename(
  patches: ParsedDiff[],
  raw: RawDiffSignals,
): { from: string; to: string } | null {
  for (const p of patches) {
    const oldRel = stripPrefix(p.oldFileName ?? '');
    const newRel = stripPrefix(p.newFileName ?? '');
    if (oldRel && newRel && oldRel !== '/dev/null' && newRel !== '/dev/null' && oldRel !== newRel) {
      return { from: oldRel, to: newRel };
    }
  }
  return raw.renames[0] ?? null;
}

/** Normalize CRLF to LF for line comparison. A CRLF base (Windows autocrlf
 *  checkout) diffed against an LF-authored edit — or vice versa — must not
 *  read as every-line-changed: that inflates the changed-line set into
 *  covered territory, and an uncovered edit can then fuse to a false SAFE. */
function normalizeEol(s: string): string {
  return s.replace(/\r\n/g, '\n');
}

export async function editsFromUnifiedDiff(repoRoot: string, diffStr: string): Promise<FileEdit[]> {
  const patches = parsePatch(diffStr);
  const raw = scanRawDiff(diffStr);

  // Refuse unsupported operations before building any edits, so a diff that also
  // does one of these never verifies on the strength of its benign hunks alone.
  const deleted = findDeletion(patches, raw);
  if (deleted) {
    throw new DiffApplyError(
      `diff deletes ${deleted}; file deletions are not supported yet, verify that change manually`,
    );
  }
  // Copies first: parsePatch models a copy-with-edit as old !== new, exactly
  // like a rename, so without this order the copy would be mislabeled.
  const copied = raw.copies[0];
  if (copied) {
    throw new DiffApplyError(
      `diff copies ${copied.from} to ${copied.to}; copies are not supported yet`,
    );
  }
  const renamed = findRename(patches, raw);
  if (renamed) {
    throw new DiffApplyError(
      `diff renames ${renamed.from} to ${renamed.to}; renames are not supported yet`,
    );
  }

  const edits: FileEdit[] = [];
  for (const p of patches) {
    const rel = stripPrefix(p.newFileName ?? p.oldFileName ?? '');
    if (!rel || rel === '/dev/null') continue;
    if (p.hunks.length === 0) continue; // metadata/binary-only entry: no content
    let base = '';
    try {
      base = await fs.readFile(path.join(repoRoot, rel), 'utf8');
    } catch {
      base = ''; // new file
    }
    const applied = applyPatch(base, p);
    if (applied === false) {
      throw new DiffApplyError(`diff did not apply to ${rel} (stale base?)`);
    }
    edits.push({ path: rel, newContent: applied });
  }

  // Binary changes are unverifiable. Alone → the diff has nothing to verify;
  // alongside text edits → still refuse, so a partial verdict on the text half
  // never reads as a verdict on the whole diff.
  if (raw.hasBinary) {
    if (edits.length === 0) {
      throw new DiffApplyError('diff contains only binary changes; nothing verifiable');
    }
    throw new DiffApplyError(
      'diff contains binary changes alongside text edits; binary changes cannot be verified',
    );
  }

  return edits;
}

export async function changedLinesForEdits(
  repoRoot: string,
  edits: FileEdit[],
): Promise<ChangedRange[]> {
  const out: ChangedRange[] = [];
  for (const e of edits) {
    let base = '';
    try {
      base = await fs.readFile(path.join(repoRoot, e.path), 'utf8');
    } catch {
      base = '';
    }
    const patch = structuredPatch(e.path, e.path, normalizeEol(base), normalizeEol(e.newContent));
    const lines: number[] = [];
    for (const hunk of patch.hunks) {
      let newLineNo = hunk.newStart;
      for (const l of hunk.lines) {
        if (l.startsWith('+')) {
          lines.push(newLineNo);
          newLineNo += 1;
        } else if (l.startsWith('-')) {
          // old-only line; does not advance the new-file counter
        } else if (l.startsWith('\\')) {
          // "\ No newline at end of file" marker — not a real line; do not advance
        } else {
          newLineNo += 1; // context line
        }
      }
    }
    out.push({ path: e.path, lines });
  }
  return out;
}
