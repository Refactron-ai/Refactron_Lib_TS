import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createShadowTree } from '../../../src/verify/shadow-tree.js';
import type { FileChange } from '../../../src/contracts.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop();
    if (fn) await fn();
  }
});

describe('createShadowTree', () => {
  it('hardlinks unchanged files and writes proposed changes', async () => {
    const src = await fs.mkdtemp(path.join(os.tmpdir(), 'st-src-'));
    await fs.writeFile(path.join(src, 'a.py'), 'print(1)\n');
    await fs.writeFile(path.join(src, 'b.py'), 'print(2)\n');

    const changes: FileChange[] = [
      {
        path: path.join(src, 'b.py'),
        oldHash: 'x',
        newContent: 'print(99)\n',
        transformId: 'format_to_fstring',
      },
    ];
    const handle = await createShadowTree(src, changes);
    cleanups.push(handle.cleanup);

    expect(await fs.readFile(path.join(handle.path, 'a.py'), 'utf8')).toBe('print(1)\n');
    expect(await fs.readFile(path.join(handle.path, 'b.py'), 'utf8')).toBe('print(99)\n');
    expect(await fs.readFile(path.join(src, 'b.py'), 'utf8')).toBe('print(2)\n');
  });

  it('excludes build caches (.git / __pycache__ / dist) but symlinks dependency dirs', async () => {
    const src = await fs.mkdtemp(path.join(os.tmpdir(), 'st-skip-'));
    // dependency-style dir — should be SYMLINKED, not skipped
    await fs.mkdir(path.join(src, 'node_modules', 'x'), { recursive: true });
    await fs.writeFile(path.join(src, 'node_modules', 'x', 'pkg.js'), 'module.exports = 1;');
    // build-output dir, should be skipped entirely
    await fs.mkdir(path.join(src, 'dist'), { recursive: true });
    await fs.writeFile(path.join(src, 'dist', 'a.js'), 'bin');
    // bytecode-cache dir, should be skipped entirely (blanket-skipped)
    await fs.mkdir(path.join(src, '__pycache__'), { recursive: true });
    await fs.writeFile(path.join(src, '__pycache__', 'a.pyc'), 'bin');
    await fs.writeFile(path.join(src, 'a.py'), 'print(1)\n');

    const handle = await createShadowTree(src, []);
    cleanups.push(handle.cleanup);

    expect(await fs.readFile(path.join(handle.path, 'a.py'), 'utf8')).toBe('print(1)\n');
    // The build-output dir is skipped entirely.
    await expect(fs.access(path.join(handle.path, 'dist'))).rejects.toThrow();
    // The bytecode-cache dir is skipped entirely.
    await expect(fs.access(path.join(handle.path, '__pycache__'))).rejects.toThrow();
    // node_modules is reachable via the symlink — the test runner needs it.
    const pkgViaShadow = await fs.readFile(
      path.join(handle.path, 'node_modules', 'x', 'pkg.js'),
      'utf8',
    );
    expect(pkgViaShadow).toBe('module.exports = 1;');
    // Confirm it's a symlink rather than a copy.
    const stat = await fs.lstat(path.join(handle.path, 'node_modules'));
    expect(stat.isSymbolicLink()).toBe(true);
  });

  it('cleanup removes the temp tree', async () => {
    const src = await fs.mkdtemp(path.join(os.tmpdir(), 'st-cln-'));
    await fs.writeFile(path.join(src, 'a.py'), 'x');
    const handle = await createShadowTree(src, []);
    await handle.cleanup();
    await expect(fs.access(handle.path)).rejects.toThrow();
  });

  // R3.2 (founder-adopted): __pycache__ is blanket-skipped, never copied into the
  // shadow. Blanket-skip makes stale-bytecode false SAFEs structurally impossible
  // (Python cannot validate a .pyc that isn't there) and avoids ENOENT races from
  // hardlinking the most volatile directory in a Python repo. This lock asserts
  // the structural invariant: NO __pycache__ survives anywhere in the shadow, for
  // both a changed dir and an unchanged one.
  it('never carries __pycache__ into the shadow, for changed and unchanged dirs alike', async () => {
    const src = await fs.mkdtemp(path.join(os.tmpdir(), 'st-pyc-'));
    // A CHANGED file with a populated sibling __pycache__.
    await fs.mkdir(path.join(src, 'pkg', '__pycache__'), { recursive: true });
    await fs.writeFile(path.join(src, 'pkg', 'mod.py'), 'x = 1\n');
    await fs.writeFile(path.join(src, 'pkg', '__pycache__', 'mod.cpython-311.pyc'), 'STALE');
    // An UNCHANGED dir with a populated __pycache__.
    await fs.mkdir(path.join(src, 'other', '__pycache__'), { recursive: true });
    await fs.writeFile(path.join(src, 'other', 'thing.py'), 'y = 1\n');
    await fs.writeFile(path.join(src, 'other', '__pycache__', 'thing.cpython-311.pyc'), 'FRESH');

    const changes: FileChange[] = [
      {
        path: path.join(src, 'pkg', 'mod.py'),
        oldHash: 'x',
        newContent: 'x = 2\n',
        transformId: 'format_to_fstring',
      },
    ];
    const handle = await createShadowTree(src, changes);
    cleanups.push(handle.cleanup);

    // Structural immunity: no __pycache__ dir survives ANYWHERE in the shadow.
    expect(await findDirsNamed(handle.path, '__pycache__')).toEqual([]);
    // Named-path spot checks for both the changed and unchanged trees.
    await expect(fs.access(path.join(handle.path, 'pkg', '__pycache__'))).rejects.toThrow();
    await expect(fs.access(path.join(handle.path, 'other', '__pycache__'))).rejects.toThrow();
    // The overlaid change is still in place, and unchanged source is mirrored.
    expect(await fs.readFile(path.join(handle.path, 'pkg', 'mod.py'), 'utf8')).toBe('x = 2\n');
    expect(await fs.readFile(path.join(handle.path, 'other', 'thing.py'), 'utf8')).toBe('y = 1\n');
    // The SOURCE bytecode is never touched; skipping is copy-time only.
    expect(
      await fs.readFile(path.join(src, 'pkg', '__pycache__', 'mod.cpython-311.pyc'), 'utf8'),
    ).toBe('STALE');
  });
});

/** Recursively collect every directory named `name` under `root`. */
async function findDirsNamed(root: string, name: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(root, entry.name);
    if (entry.name === name) out.push(full);
    out.push(...(await findDirsNamed(full, name)));
  }
  return out;
}
