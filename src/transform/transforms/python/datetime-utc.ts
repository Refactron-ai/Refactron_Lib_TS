import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import type { TransformContext, TransformResult, TransformImpl } from '../../types.js';
import { runPythonTransformWithSource } from '../../runner.js';

const SIDECAR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '_py/datetime_utc_alias.py',
);

/**
 * Wrapper around the LibCST sidecar at `_py/datetime_utc_alias.py`.
 *
 * The sidecar version-gates on `cross_file["pythonVersion"]` (>= 3.11), so we
 * always forward a cross-file payload — using the engine's when present, or a
 * stub with `pythonVersion: null` so the gate refuses cleanly.
 *
 * Uses `runPythonTransformWithSource(ctx.source, ...)` (not the path-based
 * runner) so prior in-memory transforms in the per-file pipeline still
 * compose — see runner.runPythonTransformWithSource for the data-loss bug.
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
  id: 'datetime_utc_alias',
  lang: 'python',
  apply: transform,
};
