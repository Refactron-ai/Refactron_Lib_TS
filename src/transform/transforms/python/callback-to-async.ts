import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import type { TransformContext, TransformResult, TransformImpl } from '../../types.js';
import { runPythonTransformWithSource } from '../../runner.js';

const SIDECAR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '_py/callback_to_async_await.py',
);

export async function transform(ctx: TransformContext): Promise<TransformResult> {
  // Pass `ctx.source` (not `ctx.absPath`) so prior in-memory transforms
  // compose — see runner.runPythonTransformWithSource for the data-loss bug.
  // The runner handles cross-file JSON serialization (rewriting projectRoot
  // so the sidecar's relpath() derivation still resolves to ctx.relPath).
  const r = await runPythonTransformWithSource(SIDECAR, ctx.source, {
    relPath: ctx.relPath,
    ...(ctx.crossFile ? { crossFile: ctx.crossFile } : {}),
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
  id: 'callback_to_async_await',
  lang: 'python',
  apply: transform,
};
