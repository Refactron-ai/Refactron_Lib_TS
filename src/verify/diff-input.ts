// src/verify/diff-input.ts
// Turn a change (given as {path,newContent}[] or a unified/git diff) into the
// FileEdit[] the verify pipeline consumes, and derive which new-file lines
// changed (for coverage fusion). Uses the `diff` package — no hand-rolled hunks.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { applyPatch, parsePatch, structuredPatch } from 'diff';

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

export async function editsFromUnifiedDiff(repoRoot: string, diffStr: string): Promise<FileEdit[]> {
  const patches = parsePatch(diffStr);
  const edits: FileEdit[] = [];
  for (const p of patches) {
    const rel = stripPrefix(p.newFileName ?? p.oldFileName ?? '');
    if (!rel || rel === '/dev/null') continue;
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
    const patch = structuredPatch(e.path, e.path, base, e.newContent);
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
