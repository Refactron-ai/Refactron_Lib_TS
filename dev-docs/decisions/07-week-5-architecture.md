# ADR 007 — Week 5 Architecture (TUI Integration, Config, Auth)

## Status

Accepted, 2026-05 (Week 5 finale).

## Context

Week 5 wires the v2 engines (analyze, refactor, verify) into the Ink terminal UI
that shipped behind a flag in Week-4. The legacy `src/autofix/` REPL paths still
existed, the new `src/cli/run-command.ts` orchestrator was only callable from
the one-shot CLI, and there was no project-level config or auth gate. The week
also re-enabled the golden e2e on `--transforms=all` and added cross-file scans
for the two unsafe Python transforms.

## Decision

- **TUI rewire.** REPL `/analyze`, `/refactor`, `/verify`, and `/diff` route
  through the v2 engines; legacy `autofix/verify/diff` REPL commands alias to
  `run` with a one-shot deprecation banner.
- **Boundary adapter pattern.** A `findingToIssue` adapter lives at
  `src/cli/runner.ts` boundary; the TUI and `WorkSession` persistence continue
  to consume `CodeIssue[]`, while the engines produce v2 `Finding`. No locked
  contract (`src/core/models.ts`, `src/adapters/interface.ts`) is touched.
- **Cross-file string-scan.** Both `callback_to_async_await` and
  `deprecated_api` Python sidecars accept an optional cross-file context JSON
  built once per run in `src/transform/cross-file.ts` and consume it via
  `_cross_file.py`. Module names are derived from POSIX-normalized relpaths;
  context keys are forward-slashed at the TS boundary (see Day 35 Task 17).
- **Config.** `refactron init` scaffolds `.refactronrc.json`; cosmiconfig loads
  it, ajv 8 validates against an embedded JSON-schema-7. Under Node16 module
  resolution we cast the compiled validator explicitly as
  `validate as unknown as ((d: unknown) => boolean)` because ajv's TS types
  resolve to an opaque function shape under ESM Node16.
- **Auth.** `REFACTRON_TOKEN` env var support sits alongside the credentials
  file. A `requireAuth` gate at one-shot CLI entries (`run`, `analyze`) emits a
  short, actionable error when neither is present. `refactron login
  --print-token` exposes the token for CI extraction.

## Consequences

- The golden e2e was re-enabled at Day 30 on `--transforms=all` and stays the
  binary gate; all 10 Week-4 transforms re-entered it green. As of Day 34 the
  full local gate is 214 passing tests across 62 files.
- The boundary adapter means the TUI never sees v2 `Finding`. Future engine
  iteration is free to evolve `Finding` without breaking persisted sessions.
- Cross-file string-scan is intentionally conservative: it short-circuits to
  "unsafe" on any external reference. False negatives on dynamic imports remain
  out of scope; preconditions document this.
- The auth gate runs at one-shot CLI entries only — REPL retains its existing
  in-session flow. Tests that invoke the CLI must set `REFACTRON_TOKEN` (the
  unit suite does so per-test; CI must export it in the e2e job).
- Cross-platform: cross-file relpath keys are forward-slashed at the
  `buildCrossFileContext` boundary so Windows `path.relative()` backslashes
  cannot leak into Python source-string interpolation (the Week-4 post-merge
  bug class).

## References

- `dev-docs/Refactron_Detailed_Execution_Plan.md` Part 5 Week 5.
- ADR-006 (refactor engine), ADR-004 (verify engine), ADR-005 (analyze engine).
- Day-29 cross-file plan, Day-32 auth gate, Day-34 legacy-alias plan.
