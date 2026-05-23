import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ExtendedAnalysisReport } from '../analyze/engine.js';
import type { CrossFileContext } from './types.js';

const TEST_FILE_RE = /(^|\/)test_[^/]+\.py$|_test\.py$/;
const TEST_DIR_RE = /(^|\/)tests\//;

// Cap each file's contents to avoid blowing up the JSON serialization on large projects.
const MAX_FILE_BYTES = 100 * 1024;

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function isTestFile(relPath: string): boolean {
  const normalized = toPosix(relPath);
  return TEST_FILE_RE.test(normalized) || TEST_DIR_RE.test(normalized);
}

async function readCapped(absPath: string): Promise<string> {
  try {
    const buf = await fs.readFile(absPath);
    if (buf.byteLength > MAX_FILE_BYTES) {
      return buf.subarray(0, MAX_FILE_BYTES).toString('utf8');
    }
    return buf.toString('utf8');
  } catch {
    return '';
  }
}

export interface BuildCrossFileOptions {
  /** Optional, pre-resolved minimum Python version (e.g. "3.10") — surfaced
   *  to version-gated Python sidecars. `null` means "unknown"; the sidecar
   *  treats unknown as "refuse the rewrite". */
  pythonVersion?: string | null;
}

export async function buildCrossFileContext(
  report: ExtendedAnalysisReport,
  projectRoot: string,
  opts: BuildCrossFileOptions = {},
): Promise<CrossFileContext> {
  const files: Record<string, string> = {};
  const importedBy: Record<string, string[]> = {};
  const imports: Record<string, string[]> = {};
  const testFiles: string[] = [];

  // Normalize all relpath keys and values to forward slashes at this boundary.
  // Analyzer-emitted relpaths come from path.relative() and contain backslashes
  // on Windows; the Python sidecars (and module-name derivation) expect POSIX-
  // style separators, so we normalize once here rather than in every sidecar.
  for (const [srcRaw, deps] of report.importGraph) {
    const src = toPosix(srcRaw);
    const depsPosix = [...deps].map(toPosix).sort();
    imports[src] = depsPosix;
    for (const dst of depsPosix) {
      const list = importedBy[dst] ?? [];
      if (!list.includes(src)) list.push(src);
      importedBy[dst] = list;
    }
    if (isTestFile(src) && !testFiles.includes(src)) testFiles.push(src);
    if (!(src in files)) {
      files[src] = await readCapped(path.resolve(projectRoot, src));
    }
  }

  // Files only appearing as destinations also need to be read + test-tagged.
  const allFiles = new Set<string>([...Object.keys(files), ...Object.values(imports).flat()]);
  for (const f of allFiles) {
    if (!(f in files)) {
      files[f] = await readCapped(path.resolve(projectRoot, f));
    }
    if (isTestFile(f) && !testFiles.includes(f)) testFiles.push(f);
  }
  testFiles.sort();

  // Deterministic ordering of importedBy lists.
  for (const k of Object.keys(importedBy)) {
    const v = importedBy[k];
    if (v) v.sort();
  }

  const ctx: CrossFileContext = { projectRoot, files, importedBy, imports, testFiles };
  if (opts.pythonVersion !== undefined) ctx.pythonVersion = opts.pythonVersion;
  return ctx;
}
