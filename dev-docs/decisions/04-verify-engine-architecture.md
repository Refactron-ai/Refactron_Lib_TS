# ADR 004 — Verification Engine Architecture (Week 2)

## Status

Accepted, 2026-05 (Week 2).

## Context

Refactron's v2.0 contract requires a `Verifier` that runs three gates
(syntax → imports → tests) against a candidate `RefactorPlan` on an
in-memory shadow of the project, then atomically commits the writes only on
success. The existing `src/verification/` engine is blast-radius driven and
shape-incompatible with the new `VerificationResult.gates` contract: it
selects checks by `BlastRadius.level`, returns a different result shape, and
is tightly coupled to the legacy fixer pipeline.

Editing that engine in place would entangle the new gate-composition logic
with legacy code paths and risk regressions in the in-flight CLI. We need a
greenfield tree that we can iterate on without destabilising the current
ship.

## Decision

- Build a parallel `src/verify/` tree implementing the v2.0 `Verifier`
  contract. The legacy `src/verification/` engine stays untouched and keeps
  backing the current CLI until Week 5 wires the new path in.
- Shadow projects are constructed via `fs.link` (hardlinks), with a
  `fs.copyFile` fallback for cross-device / FAT filesystems where hardlinks
  are unavailable.
- Language-specific syntax and import analysis runs in Python sidecars
  (`src/verify/checks/_py/*.py`) using the stdlib `ast` and `importlib`
  modules only. No LibCST. TypeScript uses the bundled `typescript`
  compiler API in-process.
- Writes go through `write-file-atomic` (temp file + `fs.rename`) so partial
  batch writes are impossible; phase-2 rollback removes pending temps on
  any per-file failure.
- The test gate establishes a baseline first, retrying up to 3 times to
  defeat flake (per Wang et al., ICSE 2018), and refuses to proceed if the
  baseline is already red — emitting the canonical "fix your tests first"
  blocking reason rather than misattributing flake to the candidate plan.

## Consequences

- Two verifier implementations live side-by-side during Weeks 2–4. The
  legacy engine remains the source of truth for the current CLI; the new
  `Verifier` is exercised only by unit + integration tests until Week 5.
- Windows test-gate sandboxing is deferred (tracked under ADR-003's
  deviation policy). Hardlink fallback covers the read-only check path on
  Windows; the run-tests path is gated to POSIX hosts for now.
- The coverage-of-changed-surface metric is stubbed; the real signal lands
  in Week 3 alongside the function-level import graph.
- Day-13 fuzz harness documents TypeScript parser leniency in
  `tests/unit/verify/syntax-fuzz.test.ts`: a handful of malformed inputs
  (e.g. `function f<>() {}`, `interface I extends {}`) parse cleanly under
  `ts.createSourceFile` and were replaced with stricter cases that emit
  parse diagnostics.

## References

- `dev-docs/Refactron_Detailed_Execution_Plan.md` — Part 5, Week 2
  (Days 8–14: gate composition, atomic writes, hardening).
- `dev-docs/Research/` — §Week 2 (subprocess management, sidecar isolation
  rationale).
- Wang, J. et al. "How Effectively Test Generation Tools Detect Real
  Faults?" ICSE 2018 — flake retry and coverage-of-changed-surface
  motivation.
- `write-file-atomic` — https://github.com/npm/write-file-atomic (atomic
  rename with copy fallback across devices).
