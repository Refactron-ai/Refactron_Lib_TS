import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { GateResult } from '../../contracts.js';
import type { CheckContext } from '../types.js';
import { detectRunner } from '../runners/detect.js';
import { runRunner } from '../runners/run.js';
import { summarizeVitestFailures } from '../summarize-vitest.js';

const BASELINE_RETRIES = 2; // total attempts = retries + 1 = 3
const TAIL_BYTES = 4000;

export interface TestsGateOptions {
  testCmd?: string;
  timeoutMs?: number;
  skipBaseline?: boolean;
}

export function baselineFailReason(stdout: string, stderr: string): string {
  const detail = `${stdout}\n${stderr}`.slice(-TAIL_BYTES);
  return `baseline tests already fail before refactoring; fix them first.\n${detail}`;
}

function formatVitestFailureBlock(stdout: string, stderr: string): string {
  const combined = `${stdout}\n${stderr}`;
  const summary = summarizeVitestFailures(combined);
  const tail = combined.slice(-TAIL_BYTES);
  if (summary.failures.length === 0) {
    return `tests fail after refactoring:\n${tail}`;
  }
  const lines: string[] = ['tests fail after refactoring:', '', 'Failing tests:'];
  for (const f of summary.failures) {
    lines.push(`  ✗ ${f.file} > ${f.testName}`);
    for (const ml of f.message.split('\n')) {
      lines.push(`      ${ml}`);
    }
  }
  lines.push('', 'Raw tail:', tail);
  return lines.join('\n');
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
      const baseline = await runRunner({ ...runner, cwd: h.path }, { retries: BASELINE_RETRIES });
      await h.cleanup();
      if (baseline.exitCode !== 0) {
        return {
          passed: false,
          durationMs: Date.now() - t0,
          blockingReason: baselineFailReason(baseline.stdout, baseline.stderr),
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
      blockingReason: formatVitestFailureBlock(mutated.stdout, mutated.stderr),
    };
  }
  return { passed: true, durationMs: Date.now() - t0 };
}
