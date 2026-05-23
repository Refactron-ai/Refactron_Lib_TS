import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import type { TransformContext, TransformResult, TransformImpl } from '../../types.js';
import { runPythonTransformWithSource } from '../../runner.js';

const SIDECAR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '_py/pep604_optional_union.py',
);

/**
 * Wrapper around the LibCST sidecar at `_py/pep604_optional_union.py`.
 *
 * Version-gated on `cross_file["pythonVersion"]` (>= 3.10, with a
 * `from __future__ import annotations` override). Forwards `ctx.source` so
 * composition with other transforms is preserved.
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
  id: 'pep604_optional_union',
  lang: 'python',
  apply: transform,
};
