import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { TransformContext, TransformResult, TransformImpl } from '../../types.js';
import { runPythonTransform } from '../../runner.js';

const SIDECAR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '_py/callback_to_async_await.py',
);

export async function transform(ctx: TransformContext): Promise<TransformResult> {
  let crossFilePath: string | undefined;
  let cleanupDir: string | undefined;
  if (ctx.crossFile) {
    cleanupDir = await fs.mkdtemp(path.join(os.tmpdir(), 'refactron-xf-call-'));
    crossFilePath = path.join(cleanupDir, 'cross-file.json');
    await fs.writeFile(crossFilePath, JSON.stringify(ctx.crossFile));
  }
  try {
    const opts = crossFilePath ? { crossFilePath } : {};
    const r = await runPythonTransform(SIDECAR, ctx.absPath, opts);
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
    if (cleanupDir) await fs.rm(cleanupDir, { recursive: true, force: true });
  }
}

export const impl: TransformImpl = {
  id: 'callback_to_async_await',
  lang: 'python',
  apply: transform,
};
