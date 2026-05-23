import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import type { TransformContext, TransformResult, TransformImpl } from '../../types.js';
import { runPythonTransform } from '../../runner.js';

const SIDECAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_py/super_no_args.py');

export async function transform(ctx: TransformContext): Promise<TransformResult> {
  // No cross-file context required: the rewrite is purely intra-file
  // (class-name lookup happens inside the same module's CST).
  const r = await runPythonTransform(SIDECAR, ctx.absPath);
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
  id: 'super_no_args',
  lang: 'python',
  apply: transform,
};
