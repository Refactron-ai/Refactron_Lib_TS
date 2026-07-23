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

  it('excludes build output (.git / dist) but symlinks dependency dirs', async () => {
    const src = await fs.mkdtemp(path.join(os.tmpdir(), 'st-skip-'));
    // dependency-style dir — should be SYMLINKED, not skipped
    await fs.mkdir(path.join(src, 'node_modules', 'x'), { recursive: true });
    await fs.writeFile(path.join(src, 'node_modules', 'x', 'pkg.js'), 'module.exports = 1;');
    // build-output dir, should be skipped entirely
    await fs.mkdir(path.join(src, 'dist'), { recursive: true });
    await fs.writeFile(path.join(src, 'dist', 'a.js'), 'bin');
    await fs.writeFile(path.join(src, 'a.py'), 'print(1)\n');

    const handle = await createShadowTree(src, []);
    cleanups.push(handle.cleanup);

    expect(await fs.readFile(path.join(handle.path, 'a.py'), 'utf8')).toBe('print(1)\n');
    // The build-output dir is skipped entirely.
    await expect(fs.access(path.join(handle.path, 'dist'))).rejects.toThrow();
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

  // R3.2: Python validates a .pyc against its source's mtime (1s granularity) +
  // size. An overlaid changed .py of identical byte length written within the
  // same mtime second as the original can validate a STALE .pyc and execute old
  // bytecode in the shadow, a false SAFE. For every overlaid change we drop the
  // sibling __pycache__ in the shadow so Python must recompile from the new
  // source, while unrelated bytecode (whose source is unchanged) is kept.
  it('drops the sibling __pycache__ of a changed file but keeps unrelated bytecode', async () => {
    const src = await fs.mkdtemp(path.join(os.tmpdir(), 'st-pyc-'));
    // A changed file and its (soon-to-be-stale) sibling bytecode.
    await fs.mkdir(path.join(src, 'pkg', '__pycache__'), { recursive: true });
    await fs.writeFile(path.join(src, 'pkg', 'mod.py'), 'x = 1\n');
    await fs.writeFile(path.join(src, 'pkg', '__pycache__', 'mod.cpython-311.pyc'), 'STALE');
    // An unrelated dir whose source is untouched, so its bytecode stays valid.
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

    // The changed file's sibling bytecode is gone in the shadow.
    await expect(fs.access(path.join(handle.path, 'pkg', '__pycache__'))).rejects.toThrow();
    // Unrelated bytecode survives; recompiling it would be wasted work.
    expect(
      await fs.readFile(
        path.join(handle.path, 'other', '__pycache__', 'thing.cpython-311.pyc'),
        'utf8',
      ),
    ).toBe('FRESH');
    // The overlaid change is in place.
    expect(await fs.readFile(path.join(handle.path, 'pkg', 'mod.py'), 'utf8')).toBe('x = 2\n');
    // The SOURCE bytecode is never touched; pruning is shadow-only.
    expect(
      await fs.readFile(path.join(src, 'pkg', '__pycache__', 'mod.cpython-311.pyc'), 'utf8'),
    ).toBe('STALE');
  });
});
