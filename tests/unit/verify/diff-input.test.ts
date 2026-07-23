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

  it('quoted-path EMPTY-file deletion + benign edit → still throws (review gap)', async () => {
    // git quotes header paths containing spaces, and an empty-file deletion has
    // no hunks and no `+++ /dev/null` line, so BOTH detection nets could miss
    // it. The `deleted file mode` marker alone must be proof enough to refuse.
    const repo = await tmpRepo({ 'my pkg/__init__.py': '', 'my pkg/calc.py': 'a = 1\nb = 2\n' });
    const quotedEmptyDeletion =
      'diff --git "a/my pkg/__init__.py" "b/my pkg/__init__.py"\n' +
      'deleted file mode 100644\n' +
      'index e69de29..0000000\n' +
      'diff --git "a/my pkg/calc.py" "b/my pkg/calc.py"\n' +
      'index 6794464..d63752c 100644\n' +
      '--- "a/my pkg/calc.py"\n' +
      '+++ "b/my pkg/calc.py"\n' +
      '@@ -1,2 +1,2 @@\n a = 1\n-b = 2\n+b = 3\n';
    await expect(editsFromUnifiedDiff(repo, quotedEmptyDeletion)).rejects.toBeInstanceOf(
      DiffApplyError,
    );
    await expect(editsFromUnifiedDiff(repo, quotedEmptyDeletion)).rejects.toThrow(/diff deletes/);
  });

  it('copy-with-edit diff → throws naming the copy, not a rename', async () => {
    const repo = await tmpRepo({ 'src/a.py': 'a = 1\nb = 2\n' });
    const copyWithEdit =
      'diff --git a/src/a.py b/src/a_copy.py\n' +
      'similarity index 80%\n' +
      'copy from src/a.py\n' +
      'copy to src/a_copy.py\n' +
      'index 6794464..d63752c 100644\n' +
      '--- a/src/a.py\n' +
      '+++ b/src/a_copy.py\n' +
      '@@ -1,2 +1,2 @@\n a = 1\n-b = 2\n+b = 3\n';
    await expect(editsFromUnifiedDiff(repo, copyWithEdit)).rejects.toThrow(
      /diff copies src\/a\.py to src\/a_copy\.py; copies are not supported yet/,
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

// R3.1: a hunk with NO context lines and NO deletions has no anchor to validate
// against the base. applyPatch happily inserts it at the header's line number
// even when the base has DRIFTED, fabricating content and returning no error,
// a false SAFE. git apply refuses -U0 without --unidiff-zero for this reason.
describe('editsFromUnifiedDiff - R3.1 anchorless (zero-context) hunks are rejected', () => {
  it('THE PROBE: a zero-context pure-insertion hunk on a drifted base throws, never fabricates', async () => {
    // The exact probe: base has NEW-TOP inserted (drift). The -U0 hunk claims to
    // insert after line 4, but with no context/deletion it cannot detect the
    // drift, so applyPatch silently misplaces INSERTED and returns success.
    const repo = await tmpRepo({ 'f.txt': 'A\nB\nNEW-TOP\nC\nD\nE\nF\n' });
    const u0 = '--- a/f.txt\n+++ b/f.txt\n@@ -4,0 +5 @@\n+INSERTED\n';
    await expect(editsFromUnifiedDiff(repo, u0)).rejects.toBeInstanceOf(DiffApplyError);
    await expect(editsFromUnifiedDiff(repo, u0)).rejects.toThrow(
      /diff has a zero-context hunk in f\.txt; regenerate the diff with context \(e\.g\. git diff -U3\)/,
    );
  });

  it('a -U0 hunk WITH a deletion self-anchors and still applies (unchanged behavior)', async () => {
    // A deletion line lets applyPatch match the removed text against the base, so
    // the hunk validates itself. These stay allowed.
    const repo = await tmpRepo({ 'g.txt': 'A\nB\nC\n' });
    const u0del = '--- a/g.txt\n+++ b/g.txt\n@@ -2 +2 @@\n-B\n+B2\n';
    const edits = await editsFromUnifiedDiff(repo, u0del);
    expect(edits).toEqual([{ path: 'g.txt', newContent: 'A\nB2\nC\n' }]);
  });

  it('a -U0 hunk with a deletion that does NOT match the base still fails via mismatch', async () => {
    const repo = await tmpRepo({ 'g.txt': 'totally\ndifferent\n' });
    const u0del = '--- a/g.txt\n+++ b/g.txt\n@@ -2 +2 @@\n-B\n+B2\n';
    await expect(editsFromUnifiedDiff(repo, u0del)).rejects.toBeInstanceOf(DiffApplyError);
    await expect(editsFromUnifiedDiff(repo, u0del)).rejects.toThrow(/did not apply/);
  });

  it('a brand-new file (base absent) with all-insertion hunks still creates the file', async () => {
    // A new file legitimately has no context; the whole file is insertions.
    // Base is absent, so this must NOT be rejected as anchorless.
    const repo = await tmpRepo({});
    const newFile =
      'diff --git a/new.py b/new.py\n' +
      'new file mode 100644\n' +
      'index 0000000..abc1234\n' +
      '--- /dev/null\n' +
      '+++ b/new.py\n' +
      '@@ -0,0 +1,2 @@\n+a = 1\n+b = 2\n';
    const edits = await editsFromUnifiedDiff(repo, newFile);
    expect(edits).toEqual([{ path: 'new.py', newContent: 'a = 1\nb = 2\n' }]);
  });

  it('a hunk with >=1 context line stays allowed', async () => {
    const repo = await tmpRepo({ 'h.txt': 'A\nB\nC\n' });
    const withCtx = '--- a/h.txt\n+++ b/h.txt\n@@ -1,3 +1,4 @@\n A\n B\n+INSERTED\n C\n';
    const edits = await editsFromUnifiedDiff(repo, withCtx);
    expect(edits).toEqual([{ path: 'h.txt', newContent: 'A\nB\nINSERTED\nC\n' }]);
  });
});

// R3.5: a git submodule pointer bump renders as a normal patch whose hunk
// content is `-Subproject commit <sha>` / `+Subproject commit <sha>`. The
// pointed-at path is a gitlink, not a file, so it cannot be verified through the
// shadow-tree + coverage pipeline. Refuse it explicitly rather than let it fall
// through to a confusing "did not apply".
describe('editsFromUnifiedDiff - R3.5 submodule pointer diffs are rejected', () => {
  const SUBMODULE_BUMP =
    'diff --git a/sub b/sub\n' +
    'index 1111111..2222222 160000\n' +
    '--- a/sub\n' +
    '+++ b/sub\n' +
    '@@ -1 +1 @@\n' +
    '-Subproject commit 1111111111111111111111111111111111111111\n' +
    '+Subproject commit 2222222222222222222222222222222222222222\n';

  it('a submodule bump alone throws naming the submodule path', async () => {
    const repo = await tmpRepo({});
    await expect(editsFromUnifiedDiff(repo, SUBMODULE_BUMP)).rejects.toBeInstanceOf(DiffApplyError);
    await expect(editsFromUnifiedDiff(repo, SUBMODULE_BUMP)).rejects.toThrow(
      /diff changes a git submodule pointer \(sub\); submodules are not supported yet/,
    );
  });

  it('a submodule bump mixed with a normal edit still throws (no partial verdict)', async () => {
    const repo = await tmpRepo({ 'app.py': 'a = 1\nb = 2\n' });
    const mixed =
      'diff --git a/app.py b/app.py\n' +
      'index 6794464..d63752c 100644\n' +
      '--- a/app.py\n' +
      '+++ b/app.py\n' +
      '@@ -1,2 +1,2 @@\n a = 1\n-b = 2\n+b = 3\n' +
      SUBMODULE_BUMP;
    await expect(editsFromUnifiedDiff(repo, mixed)).rejects.toBeInstanceOf(DiffApplyError);
    await expect(editsFromUnifiedDiff(repo, mixed)).rejects.toThrow(
      /diff changes a git submodule pointer \(sub\)/,
    );
  });
});

// C1: the anchorless-hunk guard (R3.1) must key off the DISK, not the diff's
// claim. A diff can lie: `--- /dev/null` on the old side asserts "new file", but
// the victim path may already exist on disk. Trusting `oldRel === '/dev/null'`
// let such a diff skip the zero-context rejection and insert at a raw line number
// onto the live file. The base on disk is the source of truth.
describe('editsFromUnifiedDiff - C1 a /dev/null claim cannot bypass the anchorless guard', () => {
  it('THE BYPASS: `--- /dev/null` claimed against an EXISTING non-empty file throws zero-context', async () => {
    // victim.py exists and is non-empty. The diff falsely claims the old side is
    // /dev/null and carries an anchorless (all-insertion) hunk. Trusting the claim
    // would skip the R3.1 guard and splice INJECTED in at a raw line number.
    const repo = await tmpRepo({ 'victim.py': 'REAL-1\nREAL-2\nREAL-3\n' });
    const spoof =
      'diff --git a/victim.py b/victim.py\n' +
      'new file mode 100644\n' +
      'index 0000000..abc1234\n' +
      '--- /dev/null\n' +
      '+++ b/victim.py\n' +
      '@@ -0,0 +1 @@\n' +
      '+INJECTED\n';
    await expect(editsFromUnifiedDiff(repo, spoof)).rejects.toBeInstanceOf(DiffApplyError);
    await expect(editsFromUnifiedDiff(repo, spoof)).rejects.toThrow(
      /diff has a zero-context hunk in victim\.py; regenerate the diff with context/,
    );
  });

  it('a genuinely absent base with `--- /dev/null` still creates the new file', async () => {
    // Regression guard: the fix trusts the disk, so a real new-file diff (base
    // truly absent) must keep working — its all-insertion hunk is legitimate.
    const repo = await tmpRepo({});
    const newFile =
      'diff --git a/fresh.py b/fresh.py\n' +
      'new file mode 100644\n' +
      'index 0000000..abc1234\n' +
      '--- /dev/null\n' +
      '+++ b/fresh.py\n' +
      '@@ -0,0 +1,2 @@\n+a = 1\n+b = 2\n';
    const edits = await editsFromUnifiedDiff(repo, newFile);
    expect(edits).toEqual([{ path: 'fresh.py', newContent: 'a = 1\nb = 2\n' }]);
  });
});

// I1: a bare `Subproject commit <hex>` content line is NOT proof of a submodule
// change — that phrase also appears verbatim in prose (a docs file about
// submodules). A real gitlink change ALWAYS carries mode 160000 on the enclosing
// entry (`index <a>..<b> 160000`, `new file mode 160000`, or `deleted file mode
// 160000`). The mode is the load-bearing signal; the content line alone is not.
describe('editsFromUnifiedDiff - I1 submodule detection requires a 160000 gitlink mode', () => {
  it('(a) a docs line `+Subproject commit <hex>` with NO gitlink mode is a normal edit', async () => {
    // A docs file documenting submodules adds a prose line that happens to read
    // `Subproject commit deadbeefcafe1234`. With a plain 100644 mode this is
    // ordinary content and must produce a normal edit, never a submodule refusal.
    const repo = await tmpRepo({ 'docs/submodules.md': 'Title\nintro\ntail\n' });
    const docsEdit =
      'diff --git a/docs/submodules.md b/docs/submodules.md\n' +
      'index 1111111..2222222 100644\n' +
      '--- a/docs/submodules.md\n' +
      '+++ b/docs/submodules.md\n' +
      '@@ -1,3 +1,4 @@\n' +
      ' Title\n' +
      ' intro\n' +
      '+Subproject commit deadbeefcafe1234\n' +
      ' tail\n';
    const edits = await editsFromUnifiedDiff(repo, docsEdit);
    expect(edits).toEqual([
      {
        path: 'docs/submodules.md',
        newContent: 'Title\nintro\nSubproject commit deadbeefcafe1234\ntail\n',
      },
    ]);
  });

  it('(b) a genuine submodule bump (index <a>..<b> 160000) still throws the submodule message', async () => {
    const repo = await tmpRepo({});
    const bump =
      'diff --git a/vendor/lib b/vendor/lib\n' +
      'index 2ebfa60..fb7df87 160000\n' +
      '--- a/vendor/lib\n' +
      '+++ b/vendor/lib\n' +
      '@@ -1 +1 @@\n' +
      '-Subproject commit 2ebfa600000000000000000000000000000000ab\n' +
      '+Subproject commit fb7df870000000000000000000000000000000ab\n';
    await expect(editsFromUnifiedDiff(repo, bump)).rejects.toBeInstanceOf(DiffApplyError);
    await expect(editsFromUnifiedDiff(repo, bump)).rejects.toThrow(
      /diff changes a git submodule pointer \(vendor\/lib\); submodules are not supported yet/,
    );
  });

  it('(c) a `new file mode 160000` submodule-add still throws the submodule message', async () => {
    const repo = await tmpRepo({});
    const add =
      'diff --git a/vendor/lib b/vendor/lib\n' +
      'new file mode 160000\n' +
      'index 0000000..fb7df87\n' +
      '--- /dev/null\n' +
      '+++ b/vendor/lib\n' +
      '@@ -0,0 +1 @@\n' +
      '+Subproject commit fb7df870000000000000000000000000000000ab\n';
    await expect(editsFromUnifiedDiff(repo, add)).rejects.toBeInstanceOf(DiffApplyError);
    await expect(editsFromUnifiedDiff(repo, add)).rejects.toThrow(
      /diff changes a git submodule pointer \(vendor\/lib\); submodules are not supported yet/,
    );
  });
});

// R3.6: fs.readFile(..., 'utf8') on a non-UTF-8 source yields U+FFFD replacement
// characters that do NOT round-trip back to the original bytes, so writing the
// "base" into the shadow would corrupt unchanged bytes. Reject non-UTF-8 bases
// loudly instead of silently mangling them.
describe('editsFromUnifiedDiff - R3.6 non-UTF-8 sources are rejected', () => {
  async function latin1Repo(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'diffin-l1-'));
    const latin1 = Buffer.concat([
      Buffer.from('# -*- coding: latin-1 -*-\nx = "', 'ascii'),
      Buffer.from([0xe9]), // é in latin-1, invalid as UTF-8
      Buffer.from('"\n', 'ascii'),
    ]);
    await fs.writeFile(path.join(dir, 'l.py'), latin1);
    return dir;
  }

  it('a latin-1 base file is rejected as not valid UTF-8', async () => {
    const repo = await latin1Repo();
    const diff = '--- a/l.py\n+++ b/l.py\n@@ -1 +1 @@\n-x = 1\n+x = 2\n';
    await expect(editsFromUnifiedDiff(repo, diff)).rejects.toBeInstanceOf(DiffApplyError);
    await expect(editsFromUnifiedDiff(repo, diff)).rejects.toThrow(
      /base file l\.py is not valid UTF-8; only UTF-8 sources are supported yet/,
    );
  });

  it('a brand-new file (no base on disk) is unaffected by the UTF-8 check', async () => {
    const repo = await tmpRepo({});
    const newFile = '--- /dev/null\n+++ b/n.py\n@@ -0,0 +1 @@\n+ok = 1\n';
    const edits = await editsFromUnifiedDiff(repo, newFile);
    expect(edits).toEqual([{ path: 'n.py', newContent: 'ok = 1\n' }]);
  });
});

// R3.7: a context line whose trailing whitespace was stripped no longer matches
// the base, so applyPatch returns false and we throw. This locks that loud
// failure so a future fuzz-tolerant parser change cannot silently misapply.
describe('editsFromUnifiedDiff - R3.7 whitespace-mangled patches fail loudly (locked)', () => {
  it('a context line with stripped trailing whitespace throws, never silently misapplies', async () => {
    const repo = await tmpRepo({ 'a.py': 'x = 1  \ny = 2\n' }); // note trailing spaces on x
    const diff = '--- a/a.py\n+++ b/a.py\n@@ -1,2 +1,2 @@\n x = 1\n-y = 2\n+y = 3\n';
    await expect(editsFromUnifiedDiff(repo, diff)).rejects.toBeInstanceOf(DiffApplyError);
    await expect(editsFromUnifiedDiff(repo, diff)).rejects.toThrow(/did not apply/);
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

  // R3.6: the base read here must reject non-UTF-8 too, so a caller that passes
  // pre-built `edits` (bypassing editsFromUnifiedDiff) cannot diff against a
  // mangled base and produce an inflated changed-line set.
  it('rejects a latin-1 base file as not valid UTF-8', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'diffin-cl-'));
    const latin1 = Buffer.concat([
      Buffer.from('x = "', 'ascii'),
      Buffer.from([0xe9]),
      Buffer.from('"\n', 'ascii'),
    ]);
    await fs.writeFile(path.join(dir, 'l.py'), latin1);
    const edits = [{ path: 'l.py', newContent: 'x = "e"\n' }];
    await expect(changedLinesForEdits(dir, edits)).rejects.toBeInstanceOf(DiffApplyError);
    await expect(changedLinesForEdits(dir, edits)).rejects.toThrow(
      /base file l\.py is not valid UTF-8; only UTF-8 sources are supported yet/,
    );
  });
});
