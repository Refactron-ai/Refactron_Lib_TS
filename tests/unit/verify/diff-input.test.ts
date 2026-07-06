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
});
