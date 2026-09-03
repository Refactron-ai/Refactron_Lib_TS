// src/verify/stability.ts
// Opt-in, downgrade-only stability check (#146). The counterpart to mutation
// (ADR-15): where --mutate perturbs the CODE and reruns, --flaky-check keeps the
// code fixed and reruns the suite K times under VARIED conditions (a different
// PYTHONHASHSEED each run). The tests gate already established one green run; if
// any rerun goes red, that green was never stable, so the verdict cannot be SAFE.
//
// The only verdict move this can cause is SAFE -> UNPROVEN. A rerun that agrees
// (green), one that is inconclusive (a timeout), and the check not being
// requested all strengthen nothing. A rerun that goes red but whose failing ids
// cannot be parsed still floors, keyed by a run-level token: a parse gap is never
// allowed to make the check lenient.
import { runRunner } from './runners/run.js';
import { detectRunner } from './runners/detect.js';
import { createShadowTree } from './shadow-tree.js';
import { extractFailureIds } from './failure-ids.js';
import type { FileChange } from '../contracts.js';

// The stability half of the verdict evidence, a sibling of CoverageAssessment and
// MutationResult on the report. `ran: false` with a skippedReason means the check
// did not conclude; a clean SAFE beside it must disclose that rather than read as
// a completed stability sweep. `varied` non-empty is the only field that blocks
// SAFE. `runs` counts reruns that produced a green/red classification (excluding
// inconclusive), so a report that is all-inconclusive shows runs: 0.
export interface StabilityResult {
  ran: boolean;
  runs: number;
  varied: string[];
  inconclusive: number;
  skippedReason?: string;
}

export interface StabilityInput {
  repoRoot: string;
  // The same changes the coverage/gates shadow was built from. A FRESH shadow is
  // built per rerun so first-run state mutation cannot mask an order/state flake
  // (the fail→heal retry isolates for the same reason).
  changes: FileChange[];
  testCmd?: string;
  timeoutMs?: number;
  runs?: number;
  // Explicit seed sequence, one per rerun. Defaults to a deterministic spread;
  // overridden in tests to provoke a specific, repeatable variance.
  seeds?: string[];
}

const DEFAULT_STABILITY_RUNS = 3;

// Seed 0 disables hash randomization (a fixed, canonical ordering); the rest pick
// distinct randomized orderings. Distinct seeds give distinct dict/set iteration
// orders, which is what deterministically shakes out an order-dependent test.
function defaultSeeds(runs: number): string[] {
  return Array.from({ length: runs }, (_, i) => String(i));
}

export async function runStabilityCheck(input: StabilityInput): Promise<StabilityResult> {
  const empty: StabilityResult = { ran: false, runs: 0, varied: [], inconclusive: 0 };
  const count = input.runs ?? DEFAULT_STABILITY_RUNS;
  const seeds = input.seeds ?? defaultSeeds(count);

  const spec = await detectRunner(input.repoRoot, {
    ...(input.testCmd ? { override: input.testCmd } : {}),
    ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
  });
  if (spec === null) return { ...empty, skippedReason: 'no test runner to rerun' };

  const varied = new Set<string>();
  let runs = 0;
  let inconclusive = 0;

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i]!;
    // A fresh tree per rerun, and PYTHONDONTWRITEBYTECODE so a run compiles from
    // source rather than a cached .pyc left by a sibling run.
    const handle = await createShadowTree(input.repoRoot, input.changes);
    try {
      const r = await runRunner(
        { ...spec, cwd: handle.path },
        { envAdd: { PYTHONHASHSEED: seed, PYTHONDONTWRITEBYTECODE: '1' } },
      );
      if (r.timedOut) {
        inconclusive += 1;
        continue;
      }
      runs += 1;
      if (r.exitCode !== 0) {
        // The gate already saw green, so a red rerun is variance. Name the tests
        // when the output parses; fall back to a run-level token so a parse gap
        // still floors.
        const ids = extractFailureIds(r.stdout, r.stderr);
        if (ids.size > 0) for (const id of ids) varied.add(id);
        else varied.add(`run ${i + 1} (seed ${seed})`);
      }
    } catch {
      inconclusive += 1;
    } finally {
      await handle.cleanup();
    }
  }

  return { ran: true, runs, varied: [...varied], inconclusive };
}
