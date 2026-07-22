import { execa } from 'execa';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import type { GateResult } from '../../contracts.js';

const SIDECAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_py/imports_check.py');

/**
 * Run the imports sidecar over `files`, resolving each top-level import against
 * `sys.path` rooted at `root`. Returns a map from each input path (exactly as
 * passed) to the set of top-level module names that do not resolve.
 *
 * Imports guarded by `if TYPE_CHECKING:` are ignored — they never run — and
 * every unresolvable import is reported, not just the first, so the gate can
 * diff a base file's set against the changed file's set and blame only what the
 * change actually introduced.
 */
export async function collectPythonUnresolved(
  root: string,
  files: string[],
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  for (const f of files) result.set(f, new Set());
  if (files.length === 0) return result;

  const { stdout, exitCode, stderr } = await execa('python3', [SIDECAR, root, ...files], {
    reject: false,
    timeout: 30_000,
  });

  // Exit 0 = analysis ran (findings, if any, are on stdout). Anything else is a
  // sidecar-internal failure (usage error, crash) and must surface, never
  // silently pass — a swallowed error here would let a broken change through.
  if (exitCode !== 0) {
    throw new Error(`imports_check.py failed (exit ${exitCode ?? 'null'}): ${stderr.trim()}`);
  }

  // Windows Python prints \r\n; a bare \n split leaves \r on the module name.
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith('UNRESOLVED\t')) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const filePath = parts[1];
    const mod = parts[2];
    if (filePath === undefined || mod === undefined) continue;
    const set = result.get(filePath) ?? new Set<string>();
    set.add(mod);
    result.set(filePath, set);
  }
  return result;
}

/**
 * Non-delta convenience check: fails if ANY file in `files` has an unresolvable
 * import. Used for the raw sidecar contract; the delta-aware gate composes
 * {@link collectPythonUnresolved} against base and shadow file sets instead.
 */
export async function checkPythonImports(root: string, files: string[]): Promise<GateResult> {
  const t0 = Date.now();
  if (files.length === 0) return { passed: true, durationMs: 0 };
  const byFile = await collectPythonUnresolved(root, files);
  for (const [filePath, mods] of byFile) {
    if (mods.size > 0) {
      const first = [...mods][0];
      return {
        passed: false,
        durationMs: Date.now() - t0,
        blockingReason: `ERR ${filePath}:${first}`,
      };
    }
  }
  return { passed: true, durationMs: Date.now() - t0 };
}
