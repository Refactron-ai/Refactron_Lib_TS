import * as path from 'node:path';
import type { GateResult } from '../../contracts.js';
import type { CheckContext } from '../types.js';
import { checkPythonSyntax } from '../checks/syntax-python.js';
import { checkTypescriptSyntax } from '../checks/syntax-typescript.js';

export async function syntaxGate(
  { shadowRoot, changes }: CheckContext,
  projectRoot: string,
): Promise<GateResult> {
  const t0 = Date.now();
  const pyFiles: string[] = [];
  const tsFiles: string[] = [];
  for (const c of changes) {
    const rel = path.relative(projectRoot, c.path);
    if (rel.startsWith('..')) {
      return {
        passed: false,
        durationMs: Date.now() - t0,
        blockingReason: `FileChange path escapes project root: ${c.path}`,
      };
    }
    const shadowed = path.join(shadowRoot, rel);
    if (c.path.endsWith('.py')) pyFiles.push(shadowed);
    else if (/\.(ts|tsx|js|jsx)$/.test(c.path)) tsFiles.push(shadowed);
  }
  const [py, tsr] = await Promise.all([
    pyFiles.length
      ? checkPythonSyntax(pyFiles)
      : Promise.resolve<GateResult>({ passed: true, durationMs: 0 }),
    tsFiles.length
      ? checkTypescriptSyntax(tsFiles)
      : Promise.resolve<GateResult>({ passed: true, durationMs: 0 }),
  ]);
  const failure = [py, tsr].find((g) => !g.passed);
  if (failure) {
    const result: GateResult = { passed: false, durationMs: Date.now() - t0 };
    if (failure.blockingReason !== undefined) result.blockingReason = failure.blockingReason;
    return result;
  }
  return { passed: true, durationMs: Date.now() - t0 };
}
