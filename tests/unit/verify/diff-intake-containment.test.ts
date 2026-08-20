// tests/unit/verify/diff-intake-containment.test.ts
//
// SEC-5. `editsFromUnifiedDiff` derived a path from the diff's own `+++` header
// and read it with no containment check, so a diff could name a file outside the
// repository and Refactron would open it.
//
// The later shadow-tree check blocks the WRITE, but the read has already
// happened by then - and whether `applyPatch` succeeds is an oracle: context
// lines only match if the attacker guessed the file's real contents, so a diff
// can be used to confirm what is in a file it is not allowed to see.
//
// Containment belongs at intake, not only at the write.
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { editsFromUnifiedDiff } from '../../../src/verify/diff-input.js';

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await fs.rm(r, { recursive: true, force: true });
});

async function repoAndSecret(): Promise<{ root: string; secret: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'intake-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'intake-out-'));
  roots.push(root, outside);
  const secret = path.join(outside, 'id_rsa');
  await fs.writeFile(secret, 'SUPER SECRET KEY MATERIAL\n');
  await fs.writeFile(path.join(root, 'app.py'), 'x = 1\n');
  return { root, secret };
}

function diffFor(rel: string, oldLine: string, newLine: string): string {
  return [`--- a/${rel}`, `+++ b/${rel}`, '@@ -1,1 +1,1 @@', `-${oldLine}`, `+${newLine}`, ''].join(
    '\n',
  );
}

describe('diff intake refuses paths outside the repository', () => {
  it('does not read a file reached by ../ traversal', async () => {
    const { root, secret } = await repoAndSecret();
    const rel = path.relative(root, secret);
    const edits = await editsFromUnifiedDiff(
      root,
      diffFor(rel, 'SUPER SECRET KEY MATERIAL', 'PWNED'),
    ).catch(() => []);
    // Either refused outright or dropped: what must never happen is an edit
    // carrying the outside file's contents.
    for (const e of edits) {
      expect(e.path).not.toContain('..');
      expect(e.newContent).not.toContain('SECRET KEY MATERIAL');
      expect(e.newContent).not.toContain('PWNED');
    }
  }, 60_000);

  it('does not read an absolute path', async () => {
    const { root, secret } = await repoAndSecret();
    const edits = await editsFromUnifiedDiff(
      root,
      diffFor(secret, 'SUPER SECRET KEY MATERIAL', 'PWNED'),
    ).catch(() => []);
    for (const e of edits) {
      expect(e.newContent).not.toContain('SECRET KEY MATERIAL');
      expect(e.newContent).not.toContain('PWNED');
    }
  }, 60_000);

  it('still accepts an ordinary in-repo path', async () => {
    // The guard must not break the normal case, including nested paths.
    const { root } = await repoAndSecret();
    await fs.mkdir(path.join(root, 'pkg', 'sub'), { recursive: true });
    await fs.writeFile(path.join(root, 'pkg', 'sub', 'm.py'), 'y = 1\n');
    const edits = await editsFromUnifiedDiff(root, diffFor('pkg/sub/m.py', 'y = 1', 'y = 2'));
    expect(edits).toHaveLength(1);
    expect(edits[0]!.path).toBe('pkg/sub/m.py');
    expect(edits[0]!.newContent).toBe('y = 2\n');
  }, 60_000);
});

// The lexical check above is necessary but not sufficient. `fs.readFile`
// follows symlinks, so `repo/link -> /secrets` makes `link/creds.txt` pass
// `isInsideRepo` and still read outside the repository. In a CI gate the
// attacker supplies the tree, so planting that link is part of the diff.
//
// Reproduced before the fix as an ORACLE, not a theoretical read: a diff whose
// removal line guessed the target's contents correctly was accepted, while a
// wrong guess reported "diff did not apply". That difference discloses the file
// one guess at a time, which is why the two directions are BOTH asserted here -
// a fix that refused only the correct guess would still leak.
describe('a symlink planted in the repo does not defeat containment', () => {
  it('refuses the read whether or not the attacker guessed the contents', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const { editsFromUnifiedDiff } = await import('../../../src/verify/diff-input.js');

    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'symlink-intake-'));
    const repo = path.join(base, 'repo');
    const secrets = path.join(base, 'secrets');
    await fs.mkdir(repo);
    await fs.mkdir(secrets);
    const SECRET = 'hunter2-the-real-password';
    await fs.writeFile(path.join(secrets, 'creds.txt'), `${SECRET}\n`);
    await fs.writeFile(path.join(repo, 'app.py'), 'x = 1\n');
    await fs.symlink(secrets, path.join(repo, 'link'));

    const diffFor = (guess: string) =>
      [
        '--- a/link/creds.txt',
        '+++ b/link/creds.txt',
        '@@ -1 +1 @@',
        `-${guess}`,
        '+owned',
        '',
      ].join('\n');

    const results: string[] = [];
    for (const guess of [SECRET, 'wrong-guess']) {
      try {
        const changes = await editsFromUnifiedDiff(repo, diffFor(guess));
        // If intake returns at all, no change may carry the secret out.
        results.push(JSON.stringify(changes));
      } catch (e) {
        results.push(`threw: ${(e as Error).message}`);
      }
    }
    await fs.rm(base, { recursive: true, force: true });

    for (const r of results) expect(r).not.toContain(SECRET);
    // The oracle is the DIFFERENCE between the two outcomes. Correct and wrong
    // guesses must now be indistinguishable, so an attacker learns nothing by
    // comparing them.
    expect(results[0]).toBe(results[1]);
  }, 60_000);
});
