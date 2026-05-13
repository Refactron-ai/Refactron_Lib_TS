# ADR 006 — Refactoring Engine Architecture (Week 4)

## Status

Accepted, 2026-05 (Week 4).

## Context

Week 4 implements the v2.0 `Refactorer` contract from `src/contracts.ts` with 10
deterministic transforms (5 Python via LibCST, 5 TypeScript via ts-morph). This is
the moat: no LLM, hand-curated preconditions per Opdyke 1992, verified by Week 2's
gate pipeline before any write.

## Decision

- Greenfield `src/transform/` tree. Legacy `src/autofix/` is untouched.
- Python transforms run in subprocess sidecars under `_py/`, invoked via execa
  with a JSON I/O contract (matches the Week 2 `verify/checks/_py/` pattern).
  LibCST is the Python-side dependency, installed via pip; documented as a
  runtime requirement.
- TypeScript transforms use ts-morph in-process. Each transform creates its own
  `Project` instance per call (no shared state, no stale-node bugs per ADR-001
  R3).
- Transform composition: per file, transforms apply in `TransformId` order
  sequentially. Each transform sees the output of the previous one. The verifier
  catches any compositional semantic break at test-gate time and refuses to
  write.
- `FileChange.transformId` records the first transform that mutated a file when
  multiple touch the same file. Full provenance lives in the namespaced
  `Precondition[]` (id format `${tid}:${relPath}:${p.id}`).
- The `run` CLI subcommand orchestrates analyze → plan → verify → write. Default
  mode is `--dry-run` unless `--apply` is passed. `--transforms=all` is the
  default selection. `--confidence` defaults to `high`.
- The engine returns the empty plan when no findings exist or every transform
  skips; the `run` command then prints "no changes to apply" and exits 0.
- If the verifier rejects a planned change (any gate fails), nothing is written
  and the `run` command exits 1 with the failing gate name and blocking reason.

## Consequences

- The golden e2e test (`tests/e2e/golden.test.ts`) is the binary success target
  for v2.0 — it asserts the full analyze → plan → verify → write pipeline
  preserves behavior on `fixtures/python-legacy-mini`. Day 28 wires Tasks 15–17;
  if any transform mutates a public surface relied on by the fixture tests, the
  verifier correctly refuses the write and the e2e fails at the CLI exit-code
  assertion. The fix lives in the transform's preconditions, not in the engine.
- Promise-chains and promise-constructor transforms ship narrow shape coverage
  in Week 4. The verifier still gates them, so they fail safe. Wider AST surgery
  is a Week-5 polish.
- LibCST becomes a documented Python runtime dependency. Users running
  `refactron run` need `pip install libcst` (or it bundles with refactron via a
  venv setup later).
- The 18-fixtures-per-transform hardening target (~180 total) is deferred to a
  post-Week-4 hardening pass. Week 4 ships 6–8 fixtures per transform — enough
  for the binary gate.
- The engine's loss of granular per-transform `FileChange` provenance (only the
  first transform id is recorded) is an accepted tradeoff for v2.0; the
  precondition log preserves the full sequence.

## References

- `dev-docs/Refactron_Detailed_Execution_Plan.md` Part 3 — transform
  preconditions per Opdyke.
- `dev-docs/Refactron_Detailed_Execution_Plan.md` Part 5 Week 4.
- `dev-docs/Research` §Week 4.
- ADR-001 (ts-morph) and ADR-002 (LibCST).
- Wang et al. ICSE 2018 — a single buggy transform poisons trust in an
  automated refactoring tool.
