import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import type { TransformContext, TransformResult, TransformImpl } from '../../types.js';
import { runPythonTransformWithSource } from '../../runner.js';

const SIDECAR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '_py/lru_cache_to_cache.py',
);

/**
 * Wrapper around the LibCST sidecar at `_py/lru_cache_to_cache.py`.
 *
 * The sidecar version-gates on `cross_file["pythonVersion"]`, so we always
 * forward a cross-file payload — using the engine's when present, or a stub
 * with `pythonVersion: null` so the gate refuses cleanly. The runner handles
 * the JSON serialization (and rewrites `projectRoot` so the sidecar's
 * relpath() derivation still resolves to ctx.relPath after the in-memory
 * source has been parked under a tmpdir).
 */
export async function transform(ctx: TransformContext): Promise<TransformResult> {
  const crossFile = ctx.crossFile ?? {
    projectRoot: '',
    files: {},
    importedBy: {},
    imports: {},
    testFiles: [],
    pythonVersion: null,
  };
  // Pass `ctx.source` (not `ctx.absPath`) so prior in-memory transforms
  // compose — see runner.runPythonTransformWithSource for the data-loss bug.
  const r = await runPythonTransformWithSource(SIDECAR, ctx.source, {
    relPath: ctx.relPath,
    crossFile,
  });
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
}

export const impl: TransformImpl = {
  id: 'lru_cache_to_cache',
  lang: 'python',
  apply: transform,
};
