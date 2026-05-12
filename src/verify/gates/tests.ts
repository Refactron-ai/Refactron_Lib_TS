import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { GateResult } from '../../contracts.js';
import type { CheckContext } from '../types.js';
import { detectRunner } from '../runners/detect.js';
import { runRunner } from '../runners/run.js';

const BASELINE_RETRIES = 2; // total attempts = retries + 1 = 3

export interface TestsGateOptions {
  testCmd?: string;
  timeoutMs?: number;
  skipBaseline?: boolean;
}

export async function testsGate(
  ctx: CheckContext,
  projectRoot: string,
  opts: TestsGateOptions,
): Promise<GateResult> {
  const t0 = Date.now();
  const detectOpts: { override?: string; timeoutMs?: number } = {};
  if (opts.testCmd !== undefined) detectOpts.override = opts.testCmd;
  if (opts.timeoutMs !== undefined) detectOpts.timeoutMs = opts.timeoutMs;
  const runner = await detectRunner(projectRoot, detectOpts);
  if (!runner) {
    return {
      passed: false,
      durationMs: Date.now() - t0,
      blockingReason: 'no test runner detected (pytest, vitest, jest); pass testCmd to override',
    };
  }
  if (!opts.skipBaseline) {
    // Baseline: run against an unmodified shadow tree.
    const baselineTree = await fs.mkdtemp(path.join(os.tmpdir(), 'refactron-baseline-'));
    try {
      const { createShadowTree } = await import('../shadow-tree.js');
      const h = await createShadowTree(projectRoot, []);
      const baseline = await runRunner(
        { ...runner, cwd: h.path },
        { retries: BASELINE_RETRIES },
      );
      await h.cleanup();
      if (baseline.exitCode !== 0) {
        return {
          passed: false,
          durationMs: Date.now() - t0,
          blockingReason:
            `baseline tests already fail before refactoring; fix them first.\n${baseline.stdout}\n${baseline.stderr}`.slice(
              0,
              4000,
            ),
        };
      }
    } finally {
      await fs.rm(baselineTree, { recursive: true, force: true });
    }
  }
  const mutated = await runRunner({ ...runner, cwd: ctx.shadowRoot }, { retries: 0 });
  if (mutated.exitCode !== 0) {
    return {
      passed: false,
      durationMs: Date.now() - t0,
      blockingReason:
        `tests fail after refactoring:\n${mutated.stdout}\n${mutated.stderr}`.slice(0, 4000),
    };
  }
  return { passed: true, durationMs: Date.now() - t0 };
}
