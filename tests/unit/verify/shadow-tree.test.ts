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

  it('excludes node_modules / .git / __pycache__ / dist', async () => {
    const src = await fs.mkdtemp(path.join(os.tmpdir(), 'st-skip-'));
    await fs.mkdir(path.join(src, 'node_modules', 'x'), { recursive: true });
    await fs.writeFile(path.join(src, 'node_modules', 'x', 'big.js'), 'huge');
    await fs.mkdir(path.join(src, '__pycache__'), { recursive: true });
    await fs.writeFile(path.join(src, '__pycache__', 'a.pyc'), 'bin');
    await fs.writeFile(path.join(src, 'a.py'), 'print(1)\n');

    const handle = await createShadowTree(src, []);
    cleanups.push(handle.cleanup);

    expect(await fs.readFile(path.join(handle.path, 'a.py'), 'utf8')).toBe('print(1)\n');
    await expect(fs.access(path.join(handle.path, 'node_modules'))).rejects.toThrow();
    await expect(fs.access(path.join(handle.path, '__pycache__'))).rejects.toThrow();
  });

  it('cleanup removes the temp tree', async () => {
    const src = await fs.mkdtemp(path.join(os.tmpdir(), 'st-cln-'));
    await fs.writeFile(path.join(src, 'a.py'), 'x');
    const handle = await createShadowTree(src, []);
    await handle.cleanup();
    await expect(fs.access(handle.path)).rejects.toThrow();
  });
});
