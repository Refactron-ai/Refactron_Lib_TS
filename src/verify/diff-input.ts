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

type Hunk = ParsedDiff['hunks'][number];

// A git submodule pointer bump renders as a hunk whose content lines are exactly
// `Subproject commit <sha>` (with the unified-diff +/-/space prefix). Requiring
// the hex sha after the literal keeps prose that merely mentions the phrase
// (e.g. a markdown line `+Subproject commit is a gitlink`) from false-matching.
const SUBPROJECT_RE = /^[-+ ]Subproject commit [0-9a-f]{7,40}(-dirty)?$/;

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
  submodules: string[]; // repo-relative paths of bumped git submodules
  hasBinary: boolean;
}

function scanRawDiff(diffStr: string): RawDiffSignals {
  const deletions: string[] = [];
  const renames: Array<{ from: string; to: string }> = [];
  const copies: Array<{ from: string; to: string }> = [];
  const submodules: string[] = [];
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
    if (SUBPROJECT_RE.test(line)) {
      // The `Subproject commit` content lines carry the submodule's path in the
      // enclosing `diff --git` header, captured above in headerOldPath.
      submodules.push(headerOldPath ?? '(path unresolved)');
      continue;
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      hasBinary = true;
    }
  }
  return { deletions, renames, copies, submodules, hasBinary };
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

/** The submodule path if this diff bumps a git submodule pointer, else null.
 *  parsePatch models a submodule bump as an ordinary patch whose hunk lines are
 *  `Subproject commit <sha>`, so we scan the parsed hunks first and fall back to
 *  the raw-text scan (belt-and-braces, in case the header path was unresolved). */
function findSubmodule(patches: ParsedDiff[], raw: RawDiffSignals): string | null {
  for (const p of patches) {
    for (const h of p.hunks) {
      if (h.lines.some((l) => SUBPROJECT_RE.test(l))) {
        return stripPrefix(p.newFileName ?? p.oldFileName ?? '') || '(path unresolved)';
      }
    }
  }
  return raw.submodules[0] ?? null;
}

/** A hunk with neither a context line nor a deletion has nothing to match
 *  against the base: applyPatch inserts it at the header's line number even when
 *  the base has drifted, silently fabricating content with no error. Such hunks
 *  are only legitimate when creating a brand-new file (handled by the caller). */
function isAnchorlessHunk(hunk: Hunk): boolean {
  let hasContext = false;
  let hasDeletion = false;
  for (const l of hunk.lines) {
    if (l.startsWith(' ')) hasContext = true;
    else if (l.startsWith('-')) hasDeletion = true;
    // '+' insertions and '\ No newline' markers do not anchor to the base.
  }
  return !hasContext && !hasDeletion;
}

/** Read a repo file as a UTF-8 string, or null if it is absent (a new file).
 *  Rejects non-UTF-8 bytes: reading them as 'utf8' substitutes U+FFFD
 *  replacement characters that do NOT round-trip, so writing the "base" into the
 *  shadow would corrupt the unchanged bytes. A byte-for-byte round-trip is a
 *  sufficient validity check. */
async function readUtf8Base(repoRoot: string, rel: string): Promise<string | null> {
  let buf: Buffer;
  try {
    buf = await fs.readFile(path.join(repoRoot, rel));
  } catch {
    return null; // absent → new file
  }
  const text = buf.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buf)) {
    throw new DiffApplyError(
      `base file ${rel} is not valid UTF-8; only UTF-8 sources are supported yet`,
    );
  }
  return text;
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
  // A submodule pointer is a gitlink, not a file: it cannot be applied to a
  // shadow tree or covered by tests, so a bump must be refused rather than fall
  // through to a confusing "did not apply".
  const submodule = findSubmodule(patches, raw);
  if (submodule) {
    throw new DiffApplyError(
      `diff changes a git submodule pointer (${submodule}); submodules are not supported yet`,
    );
  }

  const edits: FileEdit[] = [];
  for (const p of patches) {
    const rel = stripPrefix(p.newFileName ?? p.oldFileName ?? '');
    if (!rel || rel === '/dev/null') continue;
    if (p.hunks.length === 0) continue; // metadata/binary-only entry: no content
    const base = await readUtf8Base(repoRoot, rel);
    const oldRel = stripPrefix(p.oldFileName ?? '');
    const isNewFile = base === null || oldRel === '/dev/null';
    // Anchorless hunks (no context, no deletions) cannot validate against the
    // base, so they silently misapply onto a drifted base. Creating a new file
    // is the one legitimately context-free case; everything else must carry an
    // anchor. Reject rather than fabricate a wrong-location insertion.
    if (!isNewFile) {
      for (const h of p.hunks) {
        if (isAnchorlessHunk(h)) {
          throw new DiffApplyError(
            `diff has a zero-context hunk in ${rel}; regenerate the diff with context (e.g. git diff -U3)`,
          );
        }
      }
    }
    const applied = applyPatch(base ?? '', p);
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
    // Reject a non-UTF-8 base here too: a caller may pass pre-built edits and
    // skip editsFromUnifiedDiff, and diffing against a U+FFFD-mangled base would
    // inflate the changed-line set (potentially into a false SAFE).
    const base = (await readUtf8Base(repoRoot, e.path)) ?? '';
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
