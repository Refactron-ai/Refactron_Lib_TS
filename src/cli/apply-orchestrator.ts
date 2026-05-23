// src/cli/apply-orchestrator.ts
// Shared `run --apply` orchestration for the REPL (runner.ts) and the one-shot
// CLI (run-command.ts). Verifies the plan as a batch first; on a batch failure
// it re-verifies each file on its own to isolate exactly which files pass and
// which are held back, then atomically writes the passing subset.
//
// Output is emitted line-by-line through an `ApplyEmit` callback so this module
// stays free of any Ink / stdout coupling.

import * as path from 'node:path';
import type { RefactorPlan, FileChange, TransformId } from '../contracts.js';
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

interface PathGroup {
  /** Cumulative FileChange for the path — the LAST FileChange the engine
   *  emitted, whose `newContent` already composes every prior transform. */
  cumulative: FileChange;
  /** Every transformId that contributed to this file, in engine order. */
  transformIds: TransformId[];
}

/**
 * Group plan.changes by path. The engine now emits one FileChange per touching
 * transform, but everything downstream (verifier shadow tree, atomic writer,
 * per-file fallback, journal) only needs ONE entry per path — the cumulative
 * `newContent`. The last FileChange per path holds that cumulative content,
 * which is what we use to write. We retain every contributing transformId so
 * the surface still cites them all.
 */
function groupChangesByPath(changes: readonly FileChange[]): PathGroup[] {
  const map = new Map<string, PathGroup>();
  const order: string[] = [];
  for (const c of changes) {
    const existing = map.get(c.path);
    if (existing) {
      existing.cumulative = c;
      if (!existing.transformIds.includes(c.transformId)) {
        existing.transformIds.push(c.transformId);
      }
    } else {
      map.set(c.path, { cumulative: c, transformIds: [c.transformId] });
      order.push(c.path);
    }
  }
  return order.map((p) => map.get(p)!);
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

  // Group up-front: the surface and write path operate per FILE, not per
  // (file, transformId) pair. The engine emits multiple FileChanges per file
  // when multiple transforms touch it; the LAST one per path carries the
  // cumulative `newContent` that must actually hit disk.
  const groups = groupChangesByPath(plan.changes);
  const dedupedWritable = groups.map((g) => g.cumulative);

  emit.line(`  Verifying ${groups.length} file(s) …`, theme.colors.textDim);

  const batch = await new RefactronVerifier({
    projectRoot,
    ...(opts.testCmd !== undefined ? { testCmd: opts.testCmd } : {}),
    onGateStart: (g) => emitLines(formatGateStart(g)),
    onGateComplete: (g, r) => emitLines(formatGateProgress(g, r)),
    // Pass the deduped (one-per-path) cumulative changes — the verifier's
    // shadow tree should write each file once, not N times (with intermediate
    // states immediately overwritten). Future gates that iterate
    // `writableChanges` won't accidentally see duplicate entries per path.
  }).verify({ changes: dedupedWritable, preconditions: plan.preconditions });
  if (opts.signal.aborted) return { appliedChanges: [], outcome: 'none' };

  // ── Fast path — batch passed, write everything (deduped to one per path)──
  if (batch.passed) {
    emitLines(formatApplyingNotice(dedupedWritable.length));
    await writeBatchAtomic(dedupedWritable);
    // Pass the FULL per-(file,transform) list to formatVerifySuccess —
    // it groups by path internally and cites every contributing transformId.
    // Atomic writes use the deduped list above; the renderer only needs the
    // full list to surface the right transform IDs.
    emitLines(formatVerifySuccess(batch, plan, projectRoot));
    // Return all FileChanges so callers (run-command, runner) still see
    // every contributing transformId — they group again before persisting.
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

  // Per-file fallback — verify each FILE on its own (one verify per path, not
  // per transform). The cumulative `newContent` from the last FileChange per
  // path is what would actually hit disk; that's what we verify.
  emit.line(
    '  Batch verification failed — checking each file individually …',
    theme.colors.textDim,
  );
  const outcomes: PerFileOutcome[] = [];
  for (const group of groups) {
    if (opts.signal.aborted) return { appliedChanges: [], outcome: 'none' };
    const change = group.cumulative;
    const name = relName(projectRoot, change.path);
    emit.line(`  ${theme.symbols.bullet} checking ${name} …`, theme.colors.textDim);

    const r = await new RefactronVerifier({
      projectRoot,
      ...(opts.testCmd !== undefined ? { testCmd: opts.testCmd } : {}),
      skipBaseline: true,
    }).verify({ changes: [change], preconditions: [] });

    if (r.passed) {
      outcomes.push({ change, transformIds: group.transformIds, applied: true });
      emit.line(`    ${theme.symbols.pass} ${name} verified`, theme.colors.success);
    } else {
      const g = findFailedGate(r);
      const reason = g ? r.gates[g].blockingReason : undefined;
      const tests = extractFailingTestsBlock(reason);
      outcomes.push({
        change,
        transformIds: group.transformIds,
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

  const appliedGroups = outcomes.filter((o) => o.applied);
  const appliedWrites = appliedGroups.map((o) => o.change);
  if (appliedWrites.length > 0) {
    emitLines(formatApplyingNotice(appliedWrites.length));
    await writeBatchAtomic(appliedWrites);
  }
  emitLines(formatPartialApply(outcomes, projectRoot));
  // Echo back every FileChange (per touching transform) for the applied
  // paths so callers can build accurate per-transform persistence records.
  const appliedPaths = new Set(appliedWrites.map((c) => c.path));
  const appliedChanges = plan.changes.filter((c) => appliedPaths.has(c.path));
  return { appliedChanges, outcome: appliedWrites.length > 0 ? 'partial' : 'none' };
}
