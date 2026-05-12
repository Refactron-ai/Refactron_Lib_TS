import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { FileChange } from '../contracts.js';
import type { ShadowTreeHandle } from './types.js';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '__pycache__',
  '.pytest_cache',
  '.venv',
  'venv',
  '.refactron',
  'coverage',
  '.next',
  '.cache',
]);

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
      await copyTree(s, d, skipChanged);
    } else if (entry.isFile()) {
      if (skipChanged.has(path.resolve(s))) continue;
      try {
        await fs.link(s, d);
      } catch {
        await fs.copyFile(s, d);
      }
    }
  }
}
