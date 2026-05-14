# ADR 009 — Week 7 Architecture (CLI Output Redesign + Polish + Perf)

## Status
Accepted, 2026-05 (Week 7).

## Context
Through Week 6 the v2.0 pipeline shipped functional but with summary-only
output that stripped the detail users needed to act on. The acute trigger
was the test-gate failure surface — vitest FAIL lines dropped by a
front-slice in `src/verify/gates/tests.ts:62`. The broader picture:
`analyze`, `run --dry-run`, and `run --apply` all showed less than what the
engines knew.

Week 7 also surfaced two real bugs from the gauntlet-#1 self-repo run that
predated Week 7:
- `RefactronRc.exclude` was defined and validated since Week 5 but never
  plumbed into discovery (dead config).
- The REPL never loaded `.refactronrc.json` at all (a secondary gap that
  became obvious while wiring `exclude`).

## Decision

### Three presentation-layer modules under `src/cli/`
- **`format-analysis.ts`** — by-file findings + source excerpts + per-transform
  suggestions + expanded summary block. Replaces the legacy severity-grouped
  flat list with 55-char-truncated messages.
- **`format-plan.ts`** — per-file unified diffs for `run --dry-run` with
  truncation, +/- counts, header per file, `--diff-context=N` and
  `--files=GLOB` flags. Replaces the bullet-list-of-paths in the REPL and
  the raw `generateUnifiedDiff` dump in the one-shot CLI.
- **`format-verify.ts`** — gate-by-gate progress, per-file atomic-write
  list on success, structured failure surface with failing tests + in-flight
  plan + reproduce hint + culprit hint on failure. Replaces the one-line
  success and 4000-char-truncated failure blob.

All three return `RenderedLine[]` consumed by both surfaces (REPL via
`onLine`, one-shot via `process.stdout.write` + `applyColor`). `--json`
output unchanged.

### Engine-side hooks (no LOCKED contract changes)
- `RefactronVerifier` constructor opts gain `onGateComplete` and
  `onShadowRoot` callbacks. The CLI uses them to stream per-gate progress
  and capture the shadow tree path for the failure UX.
- `src/verify/gates/tests.ts` flips its `.slice(0, 4000)` front-slice to
  `.slice(-4000)` (vitest writes FAIL at the END of output), and embeds a
  structured `summarizeVitestFailures()` summary ahead of the raw tail.
- `src/verify/runners/run.ts` derives `timedOut` from observable wall-clock
  + signal instead of trusting `execa.r.timedOut` — that field is unreliable
  on Node 18 with `reject:false`.

### Gauntlet-#1 fixes
- `discovery.ts` now accepts `excludeGlobs?: string[]` and merges it into the
  loaded gitignore. `RefactronAnalyzer` plumbs `config.exclude` through.
- The REPL `analyze` and `run` branches now load `.refactronrc.json` (the
  REPL was previously ignoring it entirely).
- `format-analysis.ts:groupByFile` sorts each file's findings by line so
  rendering matches source order.
- Per-transform extended-context map in `format-analysis.ts`: function-level
  transforms (callback_to_async_await, class_to_dataclass,
  promise_chains_to_async, promise_constructor_to_async, commonjs_to_esm,
  manual_typecheck_to_hints) get more after-context so the user can see the
  body code being refactored, not just the declaration line. Single-line
  transforms (format_to_fstring, var_to_const_let) keep the tight ±1 window.

### Cross-platform consistency
- `format-types.ts:toPosix(p)` helper applied to every display-bound
  `path.relative` call in the formatters. Windows users see `src/foo.py` not
  `src\foo.py`. Internal uses of `relPath` (map keys, import resolution)
  keep native separators.

### Perf bench
- `bench/gen-fixture.ts` generates synthetic Python + TypeScript trees at a
  target LOC count with every transform pattern represented.
- Generated trees are gitignored (regenerate locally before each run).

## Bench results (2026-05-14, M-series macOS, Node 22)

| Tree size | Files | `analyze` wall-clock | Target | Headroom |
|---|---|---|---|---|
| 10k LOC | 448 | 1.31s | 6s | 4.6× |
| 100k LOC | 4 465 | 11.48s | 60s | 5.2× |
| 500k LOC | — | not run | 5min | — |

500k LOC run requires generating ~25 MB of fixture; deferred. Both measured
sizes pass with healthy headroom on first attempt — no profiling needed.

## Consequences
- The redesign removes the test-gate front-slice bug (failure surface used
  to drop the FAIL section); both `--apply` failure paths now produce
  ~30-line readable output instead of a 4000-char truncated dump.
- `.refactronrc.json` is now actually consultable from both surfaces with
  both `confidence` and `exclude` honored — closing a Week-5 dead-code gap.
- Cross-platform reliability improved: Windows path separators and Node 18
  execa quirks were caught and fixed during PR #19/#20 CI failures.
- Bench infrastructure exists; any future perf regression is detectable in
  one command.
- `RefactorPlan`, `VerificationResult`, `Verifier`, `Documenter` interfaces in
  `src/contracts.ts` — all untouched.

## Future work (deferred from Week 7)
- **Days 46-48 gauntlets #2-#5** with real beta users. Schedule when ≥3
  external developers commit. Bug-fix day from those gauntlets follows.
- **500k LOC bench** — needs ~25 MB of generated fixture; trivially runnable
  locally with `bench/gen-fixture.ts 500000`.
- **G3 polish** — current per-transform after-context is heuristic. v2.1
  could derive a real body line range from the analyzer (extending
  `DetectorFinding` with `bodyEndLine?: number`).
- **`--keep-shadow` flag** for the verifier so the user can `cd` into the
  shadow tree after a failure (currently it's cleaned up before the
  reproduce hint is read).
- **Per-test bisection** ("transform X on file Y caused test Z to fail")
  via running the test gate with progressively smaller subsets of the plan.

## References
- Source-of-truth: `dev-docs/Refactron_Detailed_Execution_Plan.md` §Week 7.
- LOCKED contract: `src/contracts.ts` (untouched).
- Existing infrastructure: `src/infrastructure/diff.ts` (Week 1),
  `src/cli/v2-adapters.ts` (Week 5), `src/ui/theme.ts`.
- Gauntlet-#1 PR: #20 (G1 + G2 + bonus Node 18 / Windows fixes).
- Output redesign PRs: #19 (Days 43-45), #18 (REPL document output routing).
