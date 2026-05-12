# ADR 005 — Deep Analysis Engine Architecture (Week 3)

## Status

Accepted, 2026-05 (Week 3).

## Context

The v2.0 `Analyzer` contract (`src/contracts.ts`) returns an `AnalysisReport` with
transform-aware findings. Legacy `src/analysis/` is blast-radius-driven and ships
analyzers for security/complexity/code-smell — different concepts. Week 3 adds a
parallel `src/analyze/` tree dedicated to `TransformId` detection.

## Decision

- Greenfield `src/analyze/`. Legacy `src/analysis/` untouched.
- Tree-sitter only for detection. LibCST and ts-morph stay reserved for Week 4
  transform-time precision checks. Two-pass design: Week 3 over-approximates,
  Week 4 prunes via precondition checks.
- Detectors register themselves at module load via side-effect imports in
  `src/analyze/engine.ts`. Each detector returns `DetectorFinding[]` with a
  `confidence` field (`high` | `medium` | `low`).
- A single tree-sitter parse per file is reused: the engine parses once, hands
  the same `tree` to every detector and to `extractCallEdges`.
- Per-file try/catch around each detector call: one bad detector cannot crash a
  whole analysis run.
- CLI subcommand `analyze` is intercepted in `src/cli/index.ts` before the legacy
  Ink app loads, via dynamic `await import('./analyze-command.js')` so the heavy
  analyzer code never enters the `--version` / `--help` fast paths. The legacy
  `analyze` route in `app.tsx` is shadowed but not removed.
- Default `--confidence=high` filters away `medium`/`low` findings. Pass
  `--confidence=low` to see everything (used by integration tests for completeness).
- Call graph is documented as may-call, not must-call — only used for impact
  warnings, never for behavior preservation.
- SQALE remediation costs are checked-in constants per `TransformId`
  (`src/analyze/sqale.ts`). Adding the 11th transform requires extending the
  `TransformId` union (locked contract, major version bump) plus a new row.

## Consequences

- Both fixture binary gates pass: `RefactronAnalyzer.analyzeExtended()` finishes
  in <5s on each `*-legacy-mini` fixture and detects every seeded transform
  (5 Python + 5 TypeScript).
- Adding the 11th+ transform later means: write a detector under
  `src/analyze/detectors/<lang>/`, register it via the side-effect import in
  `engine.ts`, add a row to `REMEDIATION_MINUTES_BY_TRANSFORM`, ship.
- ts-morph adoption for `implicit_any` precision is deferred to Week 4 — current
  detector is heuristic, marked `low` confidence and hidden by the default CLI
  confidence filter.
- The promise-chains detector flags both chained (`a.then().then()`) and nested
  (`a.then(x => b.then(...))`) patterns; both are the same async/await
  refactor target.

## References

- Plan Part 5 Week 3 (Days 15–21).
- Research doc §Week 3.
- Brunsfeld 2018 — tree-sitter rationale.
- Letouzey 2012 — SQALE methodology.
- ADR-001 / ADR-002 — language-specific transform-time toolchain choices.
