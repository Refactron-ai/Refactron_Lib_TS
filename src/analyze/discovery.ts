import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import ignore from 'ignore';

const DENY_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.refactron',
  'coverage',
  '.next',
  '.cache',
  '.turbo',
  'target',
]);
const MAX_FILE_BYTES = 1_000_000;

export type Lang = 'python' | 'typescript';

export interface FileRecord {
  absPath: string;
  relPath: string;
  lang: Lang;
}

function langOf(filename: string): Lang | null {
  if (filename.endsWith('.py')) return 'python';
  if (/\.(ts|tsx|js|jsx)$/.test(filename)) return 'typescript';
  return null;
}

async function loadGitignore(root: string): Promise<ReturnType<typeof ignore>> {
  const ig = ignore();
  try {
    const txt = await fs.readFile(path.join(root, '.gitignore'), 'utf8');
    ig.add(txt);
  } catch {
    // No .gitignore — that's fine.
  }
  return ig;
}

export interface WalkOptions {
  /** Additional gitignore-style patterns merged on top of .gitignore.
   *  Sourced from .refactronrc.json's `exclude` field. The `ignore` package
   *  treats them with gitignore semantics — `fixtures/**` excludes everything
   *  under fixtures, `*.generated.ts` excludes by basename, etc. */
  excludeGlobs?: string[];
}

export async function* walkProject(
  root: string,
  opts: WalkOptions = {},
): AsyncIterable<FileRecord> {
  const absRoot = path.resolve(root);
  const ig = await loadGitignore(absRoot);
  if (opts.excludeGlobs && opts.excludeGlobs.length > 0) {
    ig.add(opts.excludeGlobs);
  }

  async function* walk(dir: string): AsyncIterable<FileRecord> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (DENY_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(absRoot, abs);
      // ignore() expects forward slashes; emulate gitignore semantics.
      const ignKey = entry.isDirectory() ? rel.replace(/\\/g, '/') + '/' : rel.replace(/\\/g, '/');
      if (ig.ignores(ignKey)) continue;
      if (entry.isDirectory()) {
        yield* walk(abs);
      } else if (entry.isFile()) {
        const lang = langOf(entry.name);
        if (!lang) continue;
        let stat;
        try {
          stat = await fs.stat(abs);
        } catch {
          continue;
        }
        if (stat.size > MAX_FILE_BYTES) continue;
        yield { absPath: abs, relPath: rel, lang };
      }
    }
  }
  yield* walk(absRoot);
}
