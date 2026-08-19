import * as fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { FileChange } from '../contracts.js';
import type { ShadowTreeHandle } from './types.js';

// Dirs we never copy/walk into the shadow tree. Build outputs, caches, and
// VCS state are pure noise. Source dirs to mutate are NOT here.
const SKIP_DIRS = new Set([
  '.git',
  'dist',
  'build',
  '__pycache__',
  '.pytest_cache',
  '.refactron',
  'coverage',
  '.next',
  '.cache',
]);

// Dirs we symlink rather than copy/hardlink. These contain installed
// dependencies the test runner needs — copying them is wasteful (hundreds of
// MB) and hardlinking them is fragile (npm/pip frequently mutate state inside).
// A symlink gives the shadow tree's test command everything it needs while
// keeping the dest dir cheap.
const SYMLINK_DIRS = new Set(['node_modules', '.venv', 'venv']);

export async function createShadowTree(
  sourceRoot: string,
  changes: FileChange[],
): Promise<ShadowTreeHandle> {
  const dest = await fs.mkdtemp(path.join(os.tmpdir(), 'refactron-shadow-'));
  const changedPaths = new Set(changes.map((c) => path.resolve(c.path)));

  await copyTree(sourceRoot, dest, changedPaths);

  for (const change of changes) {
    const rel = path.relative(sourceRoot, change.path);
    if (rel.startsWith('..')) {
      throw new Error(`FileChange path escapes source root: ${change.path}`);
    }
    const target = path.join(dest, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, change.newContent, 'utf8');
  }

  return {
    path: dest,
    cleanup: () => fs.rm(dest, { recursive: true, force: true }),
  };
}

async function copyTree(src: string, dest: string, skipChanged: Set<string>): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (SYMLINK_DIRS.has(entry.name)) {
        // Symlink installed-dependency dirs (node_modules, .venv, venv). The
        // test gate's runner (vitest, jest, pytest) needs these to be reachable;
        // hardlinking thousands of files is wasteful and breaks npm bin symlinks.
        // CRITICAL: use the absolute path as the symlink target. A relative target
        // would resolve from the symlink's parent (the shadow tree) and loop back
        // to itself (ELOOP).
        const absoluteTarget = path.resolve(s);
        try {
          await fs.symlink(absoluteTarget, d, 'dir');
        } catch {
          // Fall back to recursive copy if the platform/FS rejects symlinks
          // (e.g. Windows without developer mode). Rare; degrades gracefully.
          await copyTree(s, d, skipChanged);
        }
        continue;
      }
      await copyTree(s, d, skipChanged);
    } else if (entry.isFile()) {
      if (skipChanged.has(path.resolve(s))) continue;
      // COPY, never hardlink. A hardlink shares the inode with the caller's real
      // file, and the tests gate executes code the DIFF supplied - a diff may
      // edit conftest.py, a fixture, or any test file. Any in-place write from
      // that suite then lands in the user's repository, silently, while the
      // verdict says SAFE. Reproduced: a diff naming only tests/test_app.py
      // rewrote app.py in the source tree. It also fires by accident, on any
      // suite with a snapshot updater or a test that writes a fixture.
      //
      // COPYFILE_FICLONE asks for a copy-on-write clone, so on APFS, Btrfs and
      // XFS this keeps the speed a hardlink was chosen for while giving each
      // tree its own inode on first write. On filesystems without reflink
      // support the flag is ignored and this degrades to a normal copy.
      await fs.copyFile(s, d, fsConstants.COPYFILE_FICLONE);
    } else if (entry.isSymbolicLink()) {
      // Mirror the symlink (target may be absolute or relative; either works).
      try {
        const linkTarget = await fs.readlink(s);
        await fs.symlink(linkTarget, d);
      } catch {
        // Ignore — symlinks that can't be replicated aren't worth blocking on.
      }
    }
  }
}
