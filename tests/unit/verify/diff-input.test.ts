import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  editsFromUnifiedDiff,
  changedLinesForEdits,
  DiffApplyError,
} from '../../../src/verify/diff-input.js';

async function tmpRepo(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'diffin-'));
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(path.join(dir, path.dirname(rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), content);
  }
  return dir;
}

describe('editsFromUnifiedDiff', () => {
  it('applies a unified diff to the base to produce newContent', async () => {
    const repo = await tmpRepo({ 'a.py': 'x = 1\ny = 2\n' });
    const diff = '--- a/a.py\n+++ b/a.py\n@@ -1,2 +1,2 @@\n x = 1\n-y = 2\n+y = 3\n';
    const edits = await editsFromUnifiedDiff(repo, diff);
    expect(edits).toEqual([{ path: 'a.py', newContent: 'x = 1\ny = 3\n' }]);
  });

  it('throws DiffApplyError when the hunk does not apply to the base', async () => {
    const repo = await tmpRepo({ 'a.py': 'totally different\n' });
    const diff = '--- a/a.py\n+++ b/a.py\n@@ -1,2 +1,2 @@\n x = 1\n-y = 2\n+y = 3\n';
    await expect(editsFromUnifiedDiff(repo, diff)).rejects.toBeInstanceOf(DiffApplyError);
  });

  it('applies a unified diff spanning multiple files', async () => {
    const repo = await tmpRepo({ 'f1.py': 'p = 1\n', 'f2.py': 'q = 1\n' });
    const diff =
      '--- a/f1.py\n+++ b/f1.py\n@@ -1 +1 @@\n-p = 1\n+p = 2\n' +
      '--- a/f2.py\n+++ b/f2.py\n@@ -1 +1 @@\n-q = 1\n+q = 2\n';
    const edits = await editsFromUnifiedDiff(repo, diff);
    expect(edits).toEqual([
      { path: 'f1.py', newContent: 'p = 2\n' },
      { path: 'f2.py', newContent: 'q = 2\n' },
    ]);
  });
});

// Unsupported operations must be REJECTED loudly, never silently dropped. A
// silent drop of a deletion inside an otherwise-benign diff verified SAFE while
// the applied diff ImportError'd the whole package (the B1b regression). v1 is
// honesty-first: deletions/renames/binary are named and refused (exit 2), not
// partially verified.
describe('editsFromUnifiedDiff — unsupported operations are rejected loudly', () => {
  const DELETE_ONLY =
    'diff --git a/src/attr/_config.py b/src/attr/_config.py\n' +
    'deleted file mode 100644\n' +
    'index 4b25772..0000000\n' +
    '--- a/src/attr/_config.py\n' +
    '+++ /dev/null\n' +
    '@@ -1,2 +0,0 @@\n' +
    '-_run_validators = True\n' +
    '-x = 1\n';

  it('deletion-only diff → throws DiffApplyError naming the deleted file', async () => {
    const repo = await tmpRepo({ 'src/attr/_config.py': '_run_validators = True\nx = 1\n' });
    await expect(editsFromUnifiedDiff(repo, DELETE_ONLY)).rejects.toBeInstanceOf(DiffApplyError);
    await expect(editsFromUnifiedDiff(repo, DELETE_ONLY)).rejects.toThrow(
      /diff deletes src\/attr\/_config\.py; file deletions are not supported yet/,
    );
  });

  it('THE REGRESSION: deletion mixed with a benign covered edit → throws, never SAFE', async () => {
    // A git diff that deletes _config.py AND makes an innocuous edit elsewhere.
    // Previously the deletion was `continue`-skipped and the edit alone verified
    // SAFE, while `git apply` of the same diff broke every import of the package.
    const repo = await tmpRepo({
      'src/attr/_config.py': '_run_validators = True\nx = 1\n',
      'src/attr/_make.py': 'a = 1\nb = 2\n',
    });
    const mixed =
      DELETE_ONLY +
      'diff --git a/src/attr/_make.py b/src/attr/_make.py\n' +
      'index 6794464..d63752c 100644\n' +
      '--- a/src/attr/_make.py\n' +
      '+++ b/src/attr/_make.py\n' +
      '@@ -1,2 +1,2 @@\n a = 1\n-b = 2\n+b = 3\n';
    await expect(editsFromUnifiedDiff(repo, mixed)).rejects.toBeInstanceOf(DiffApplyError);
    await expect(editsFromUnifiedDiff(repo, mixed)).rejects.toThrow(
      /diff deletes src\/attr\/_config\.py/,
    );
  });

  it('rename-with-edit diff → throws naming both the old and new path', async () => {
    // A rename that also carries content edits: parsePatch models it as old!=new.
    const repo = await tmpRepo({ 'src/attr/_config.py': 'a = 1\nb = 2\n' });
    const renameWithEdit =
      'diff --git a/src/attr/_config.py b/src/attr/_cfg.py\n' +
      'similarity index 80%\n' +
      'rename from src/attr/_config.py\n' +
      'rename to src/attr/_cfg.py\n' +
      'index 6794464..d63752c 100644\n' +
      '--- a/src/attr/_config.py\n' +
      '+++ b/src/attr/_cfg.py\n' +
      '@@ -1,2 +1,2 @@\n a = 1\n-b = 2\n+b = 3\n';
    await expect(editsFromUnifiedDiff(repo, renameWithEdit)).rejects.toBeInstanceOf(DiffApplyError);
    await expect(editsFromUnifiedDiff(repo, renameWithEdit)).rejects.toThrow(
      /diff renames src\/attr\/_config\.py to src\/attr\/_cfg\.py; renames are not supported yet/,
    );
  });

  it('pure 100%-rename diff (parsePatch drops it) → still throws via raw scan', async () => {
    // A 100%-similarity rename produces no hunks; the `diff` package's parsePatch
    // drops the entry entirely. The raw-text scan for `rename from`/`rename to`
    // is the belt-and-braces net that keeps it from vanishing into a false SAFE.
    const repo = await tmpRepo({ 'src/attr/_config.py': 'a = 1\n' });
    const pureRename =
      'diff --git a/src/attr/_config.py b/src/attr/_cfg.py\n' +
      'similarity index 100%\n' +
      'rename from src/attr/_config.py\n' +
      'rename to src/attr/_cfg.py\n';
    await expect(editsFromUnifiedDiff(repo, pureRename)).rejects.toThrow(
      /diff renames src\/attr\/_config\.py to src\/attr\/_cfg\.py/,
    );
  });

  it('binary-only diff → distinct "nothing verifiable" message', async () => {
    const repo = await tmpRepo({});
    const binary =
      'diff --git a/docs_img.png b/docs_img.png\n' +
      'new file mode 100644\n' +
      'index 0000000..3c3603b\n' +
      'Binary files /dev/null and b/docs_img.png differ\n';
    await expect(editsFromUnifiedDiff(repo, binary)).rejects.toBeInstanceOf(DiffApplyError);
    await expect(editsFromUnifiedDiff(repo, binary)).rejects.toThrow(
      /diff contains only binary changes; nothing verifiable/,
    );
  });

  it('binary change alongside a text edit → throws (no partial verdict)', async () => {
    const repo = await tmpRepo({ 'src/attr/_make.py': 'a = 1\nb = 2\n' });
    const binaryPlusEdit =
      'diff --git a/src/attr/_make.py b/src/attr/_make.py\n' +
      'index 6794464..d63752c 100644\n' +
      '--- a/src/attr/_make.py\n' +
      '+++ b/src/attr/_make.py\n' +
      '@@ -1,2 +1,2 @@\n a = 1\n-b = 2\n+b = 3\n' +
      'diff --git a/docs_img.png b/docs_img.png\n' +
      'new file mode 100644\n' +
      'index 0000000..3c3603b\n' +
      'Binary files /dev/null and b/docs_img.png differ\n';
    await expect(editsFromUnifiedDiff(repo, binaryPlusEdit)).rejects.toBeInstanceOf(DiffApplyError);
    await expect(editsFromUnifiedDiff(repo, binaryPlusEdit)).rejects.toThrow(/binary changes/);
  });
});

describe('changedLinesForEdits', () => {
  it('reports the new-file line numbers that changed', async () => {
    const repo = await tmpRepo({ 'a.py': 'a = 1\nb = 2\nc = 3\n' });
    const edits = [{ path: 'a.py', newContent: 'a = 1\nb = 20\nc = 3\n' }];
    const ranges = await changedLinesForEdits(repo, edits);
    expect(ranges).toEqual([{ path: 'a.py', lines: [2] }]);
  });

  it('treats a brand-new file as all-lines-changed', async () => {
    const repo = await tmpRepo({});
    const edits = [{ path: 'new.py', newContent: 'a = 1\nb = 2\n' }];
    const ranges = await changedLinesForEdits(repo, edits);
    expect(ranges).toEqual([{ path: 'new.py', lines: [1, 2] }]);
  });

  it('reports the right line when neither base nor edit ends in a newline', async () => {
    const repo = await tmpRepo({ 'x.py': 'a\nb' });
    const edits = [{ path: 'x.py', newContent: 'a\nc' }];
    const ranges = await changedLinesForEdits(repo, edits);
    expect(ranges).toEqual([{ path: 'x.py', lines: [2] }]);
  });

  it('does not advance the new-file counter across multiple deleted lines', async () => {
    const repo = await tmpRepo({ 'y.py': 'a\nb\nc\nd\n' });
    const edits = [{ path: 'y.py', newContent: 'a\nX\nd\n' }];
    const ranges = await changedLinesForEdits(repo, edits);
    expect(ranges).toEqual([{ path: 'y.py', lines: [2] }]);
  });

  it('does not inflate changed lines when the base is CRLF and the edit is LF', async () => {
    // A CRLF checkout (Windows autocrlf) vs an LF-authored edit must not mark
    // every line as changed — that widens the changed-line set into covered
    // territory and can turn an uncovered edit into a false SAFE.
    const repo = await tmpRepo({ 'w.py': 'a = 1\r\nb = 2\r\nc = 3\r\n' });
    const edits = [{ path: 'w.py', newContent: 'a = 1\nb = 20\nc = 3\n' }];
    const ranges = await changedLinesForEdits(repo, edits);
    expect(ranges).toEqual([{ path: 'w.py', lines: [2] }]);
  });

  it('does not inflate changed lines when the base is LF and the edit is CRLF', async () => {
    const repo = await tmpRepo({ 'v.py': 'a = 1\nb = 2\nc = 3\n' });
    const edits = [{ path: 'v.py', newContent: 'a = 1\r\nb = 20\r\nc = 3\r\n' }];
    const ranges = await changedLinesForEdits(repo, edits);
    expect(ranges).toEqual([{ path: 'v.py', lines: [2] }]);
  });
});
