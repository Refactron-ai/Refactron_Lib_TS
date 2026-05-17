// src/cli/apply-orchestrator.ts
// Shared `run --apply` orchestration for the REPL (runner.ts) and the one-shot
// CLI (run-command.ts). Verifies the plan as a batch first; on a batch failure
// it re-verifies each file on its own to isolate exactly which files pass and
// which are held back, then atomically writes the passing subset.
//
// Output is emitted line-by-line through an `ApplyEmit` callback so this module
// stays free of any Ink / stdout coupling.

import * as path from 'node:path';
import type { RefactorPlan, FileChange } from '../contracts.js';
import { RefactronVerifier } from '../verify/engine.js';
import { writeBatchAtomic } from '../verify/atomic-batch-writer.js';
import { theme } from '../ui/theme.js';
import { type RenderedLine, toPosix } from './format-types.js';
import {
  formatGateStart,
  formatGateProgress,
  formatApplyingNotice,
  formatVerifySuccess,
  formatPartialApply,
  formatBaselineBroken,
  formatNoTestRunner,
  findFailedGate,
  extractFailingTestsBlock,
  type PerFileOutcome,
} from './format-verify.js';

export interface ApplyEmit {
  line(text: string, color?: string): void;
}

export type ApplyOutcome = 'all' | 'partial' | 'none' | 'baseline-broken' | 'no-runner';

export interface ApplyResult {
  /** The changes that were verified and written to disk. */
  appliedChanges: FileChange[];
  outcome: ApplyOutcome;
}

export interface ApplyOptions {
  testCmd?: string;
  signal: AbortSignal;
}

function relName(projectRoot: string, p: string): string {
  return toPosix(path.relative(projectRoot, p) || p);
}

/**
 * Verify a plan and apply it. Batch-first: one shadow tree, all changes. If the
 * batch passes, every file is written. If it fails, each file is re-verified
 * individually (its own shadow tree, baseline skipped — the batch already
 * proved the baseline is green) and only the passing files are written.
 */
export async function runApplyWithVerification(
  plan: RefactorPlan,
  projectRoot: string,
  emit: ApplyEmit,
  opts: ApplyOptions,
): Promise<ApplyResult> {
  const emitLines = (lines: RenderedLine[]): void => {
    for (const l of lines) emit.line(l.text, l.color);
  };

  emit.line(`  Verifying ${plan.changes.length} change(s) …`, theme.colors.textDim);

  const batch = await new RefactronVerifier({
    projectRoot,
    ...(opts.testCmd !== undefined ? { testCmd: opts.testCmd } : {}),
    onGateStart: (g) => emitLines(formatGateStart(g)),
    onGateComplete: (g, r) => emitLines(formatGateProgress(g, r)),
  }).verify(plan);
  if (opts.signal.aborted) return { appliedChanges: [], outcome: 'none' };

  // ── Fast path — batch passed, write everything ────────────────────────────
  if (batch.passed) {
    emitLines(formatApplyingNotice(plan.changes.length));
    await writeBatchAtomic(batch.writableChanges);
    emitLines(formatVerifySuccess(batch, plan, projectRoot));
    return { appliedChanges: batch.writableChanges, outcome: 'all' };
  }

  // ── Batch failed ──────────────────────────────────────────────────────────
  const failedGate = findFailedGate(batch);
  const failedReason = failedGate ? batch.gates[failedGate].blockingReason : undefined;

  // A red baseline means the project's own tests already fail — per-file
  // isolation would just blame every file. Stop and say so.
  if (failedGate === 'tests' && failedReason?.includes('baseline tests already fail')) {
    emitLines(formatBaselineBroken(failedReason));
    return { appliedChanges: [], outcome: 'baseline-broken' };
  }

  // No test runner at all — a project-setup problem, not a per-file one.
  // Per-file isolation would just repeat this same message for every file.
  if (failedGate === 'tests' && failedReason?.includes('no test runner detected')) {
    emitLines(formatNoTestRunner(failedReason));
    return { appliedChanges: [], outcome: 'no-runner' };
  }

  // Per-file fallback — verify each change on its own to isolate the culprits.
  emit.line(
    '  Batch verification failed — checking each file individually …',
    theme.colors.textDim,
  );
  const outcomes: PerFileOutcome[] = [];
  for (const change of plan.changes) {
    if (opts.signal.aborted) return { appliedChanges: [], outcome: 'none' };
    const name = relName(projectRoot, change.path);
    emit.line(`  ${theme.symbols.bullet} checking ${name} …`, theme.colors.textDim);

    const r = await new RefactronVerifier({
      projectRoot,
      ...(opts.testCmd !== undefined ? { testCmd: opts.testCmd } : {}),
      skipBaseline: true,
    }).verify({ changes: [change], preconditions: [] });

    if (r.passed) {
      outcomes.push({ change, applied: true });
      emit.line(`    ${theme.symbols.pass} ${name} verified`, theme.colors.success);
    } else {
      const g = findFailedGate(r);
      const reason = g ? r.gates[g].blockingReason : undefined;
      const tests = extractFailingTestsBlock(reason);
      outcomes.push({
        change,
        applied: false,
        ...(g ? { failedGate: g } : {}),
        ...(tests ? { failingTests: tests } : {}),
        ...(reason && !tests ? { rawReason: reason } : {}),
      });
      emit.line(
        `    ${theme.symbols.fail} ${name} blocked at '${g ?? 'unknown'}'`,
        theme.colors.error,
      );
    }
  }

  const applied = outcomes.filter((o) => o.applied).map((o) => o.change);
  if (applied.length > 0) {
    emitLines(formatApplyingNotice(applied.length));
    await writeBatchAtomic(applied);
  }
  emitLines(formatPartialApply(outcomes, projectRoot));
  return { appliedChanges: applied, outcome: applied.length > 0 ? 'partial' : 'none' };
}
