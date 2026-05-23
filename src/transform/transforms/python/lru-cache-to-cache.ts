import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { TransformContext, TransformResult, TransformImpl } from '../../types.js';
import { runPythonTransform } from '../../runner.js';

const SIDECAR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '_py/lru_cache_to_cache.py',
);

/**
 * Wrapper around the LibCST sidecar at `_py/lru_cache_to_cache.py`.
 *
 * Perf note: this always writes a tiny cross-file JSON (~100 bytes) to a
 * tmpdir even when the caller didn't supply one. The temp-file overhead
 * is sub-millisecond on tmpfs (modern macOS/Linux), and the total per-file
 * wall time is dominated by Python interpreter cold-start (~50–150 ms),
 * so we don't bother special-casing the no-cross-file path. No benchmark
 * has shown this to be a bottleneck.
 */
export async function transform(ctx: TransformContext): Promise<TransformResult> {
  // The version gate requires `cross_file["pythonVersion"]` — write a
  // minimal cross-file JSON whenever the engine gave us one. When it didn't
  // (e.g. unit tests that synthesize a TransformContext without cross-file),
  // we still write a stub so the sidecar can read `pythonVersion: null` and
  // refuse cleanly with `python_version_too_low`.
  const cleanupDir = await fs.mkdtemp(path.join(os.tmpdir(), 'refactron-xf-lru-'));
  const crossFilePath = path.join(cleanupDir, 'cross-file.json');
  const payload = ctx.crossFile ?? {
    projectRoot: '',
    files: {},
    importedBy: {},
    imports: {},
    testFiles: [],
    pythonVersion: null,
  };
  await fs.writeFile(crossFilePath, JSON.stringify(payload));
  try {
    const r = await runPythonTransform(SIDECAR, ctx.absPath, { crossFilePath });
    if (!r.ok) {
      return {
        newContent: null,
        preconditions: [{ id: 'sidecar-error', satisfied: false, reason: r.error }],
      };
    }
    return {
      newContent: r.newContent === '' ? null : r.newContent,
      preconditions: r.preconditions,
    };
  } finally {
    await fs.rm(cleanupDir, { recursive: true, force: true });
  }
}

export const impl: TransformImpl = {
  id: 'lru_cache_to_cache',
  lang: 'python',
  apply: transform,
};
