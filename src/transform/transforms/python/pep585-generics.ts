import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import type { TransformContext, TransformResult, TransformImpl } from '../../types.js';
import { runPythonTransformWithSource } from '../../runner.js';

const SIDECAR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '_py/pep585_generics.py',
);

/**
 * Wrapper around the LibCST sidecar at `_py/pep585_generics.py`.
 *
 * The sidecar is version-gated on `cross_file["pythonVersion"]` (>= 3.9, with
 * a `from __future__ import annotations` override), so we always forward a
 * cross-file payload — using the engine's when present, or a stub with
 * `pythonVersion: null` so the gate refuses cleanly. The runner takes
 * `ctx.source` (not `ctx.absPath`) so the in-memory composition with prior
 * transforms is preserved.
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
  id: 'pep585_generics',
  lang: 'python',
  apply: transform,
};
