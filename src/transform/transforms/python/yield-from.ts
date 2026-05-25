import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import type { TransformContext, TransformResult, TransformImpl } from '../../types.js';
import { runPythonTransformWithSource } from '../../runner.js';

const SIDECAR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '_py/yield_from_for_loop.py',
);

/**
 * Wrapper around the LibCST sidecar at `_py/yield_from_for_loop.py`.
 *
 * No version gate (`yield from` ships in every supported Python), so the
 * cross-file payload here exists purely for the runner's tmpdir / relpath
 * machinery. Uses `runPythonTransformWithSource` so prior in-memory transforms
 * compose correctly through the per-file pipeline.
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
  id: 'yield_from_for_loop',
  lang: 'python',
  apply: transform,
};
