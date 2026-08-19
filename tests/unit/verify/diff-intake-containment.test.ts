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
