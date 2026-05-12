import * as path from 'node:path';
import type { GateResult } from '../../contracts.js';
import type { CheckContext } from '../types.js';
import { checkPythonImports } from '../checks/imports-python.js';
import { checkTypescriptImports } from '../checks/imports-typescript.js';

export async function importsGate(ctx: CheckContext, projectRoot: string): Promise<GateResult> {
  const t0 = Date.now();
  const py: string[] = [];
  const tsf: string[] = [];
  for (const c of ctx.changes) {
    const rel = path.relative(projectRoot, c.path);
    if (rel.startsWith('..')) {
      return {
        passed: false,
        durationMs: Date.now() - t0,
        blockingReason: `FileChange path escapes project root: ${c.path}`,
      };
    }
    const shadowed = path.join(ctx.shadowRoot, rel);
    if (c.path.endsWith('.py')) py.push(shadowed);
    else if (/\.(ts|tsx|js|jsx)$/.test(c.path)) tsf.push(shadowed);
  }
  const [pr, tr] = await Promise.all([
    py.length
      ? checkPythonImports(ctx.shadowRoot, py)
      : Promise.resolve<GateResult>({ passed: true, durationMs: 0 }),
    tsf.length
      ? checkTypescriptImports(ctx.shadowRoot, tsf)
      : Promise.resolve<GateResult>({ passed: true, durationMs: 0 }),
  ]);
  const fail = [pr, tr].find((g) => !g.passed);
  if (fail) {
    const result: GateResult = { passed: false, durationMs: Date.now() - t0 };
    if (fail.blockingReason !== undefined) result.blockingReason = fail.blockingReason;
    return result;
  }
  return { passed: true, durationMs: Date.now() - t0 };
}
