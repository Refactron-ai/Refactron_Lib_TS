# Changelog

All notable changes to Refactron are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.4] — 2026-06-17

Reliability and observability release. Five real fixes, one feature (tier taxonomy), one license change. No new transforms, no API breakage — every existing call site keeps working.

### Added

- **Tier taxonomy on every transform** (debt / modernization / style). `analyze` output now groups findings and remediation minutes by tier, so the headline "N findings" splits into "57 debt (315 min), 102 modernization (490 min), 2,569 style (4,483 min)" instead of one undifferentiated count.
- **`byTier` and `minutesByTier` fields** in `analyze --json` output. Invariant: `debt + modernization + style === totalMinutes`.
- **BY TIER section** in the boxed TUI analyze output, sitting above BY TRANSFORM.

### Changed

- **License: MIT → Apache 2.0.** Every right MIT granted is still granted; Apache 2.0 adds an explicit patent grant from contributors. Closes a question enterprise legal teams routinely raise before adopting source-code tooling. See `LICENSE`, `NOTICE`, and `docs/faq.mdx#why-apache-20`.

### Fixed

- **`run --transforms=all` silently dropped 8 transforms.** The CLI's local `TRANSFORM_IDS` list had drifted out of sync with the engine's `TRANSFORM_ORDER` when the v0.2.3 catalog expansion landed — `--transforms=all` was passing only 12 of 20 ids to the engine. The CLI now imports `TRANSFORM_ORDER` directly so there's exactly one list. Drift is also pinned by a new test that cross-checks the alphabetised set. (closes #48; PR #49)
- **`--files=<glob>` was ignored on `--apply`.** The glob filter only narrowed the dry-run preview; the apply path silently rewrote every matching finding regardless of scope. The filter is now applied to `plan.changes` before the dry-run / apply split, so both paths honour it. (closes #50; PR #52)
- **Documenter broke files with multi-line return-type signatures.** On signatures like `def get_dataclass(...) -> type[\n  Union[\n    A,\n    B,\n  ]\n]:` the docstring inserter latched onto the first inner line of the type subscript as if it were the function body, producing syntactically invalid Python. The inserter now walks bracket-balanced signatures and recognises single-line `def f() -> T: ...` Protocol stubs as having no separate body to insert above. (closes #51; PR #52)
- **`apply` and `rollback` dropped POSIX file modes.** Atomic-writer and rollback both reset mode bits to umask defaults instead of preserving the original. Both paths now round-trip modes. Mode-preservation tests skip on Windows (NTFS does not honour POSIX modes). (8e2020e)
- **`class_to_dataclass` injected imports before `from __future__`.** Generated `from dataclasses import dataclass` landed at line 0 even when the module led with `from __future__ import annotations`, breaking PEP 236 ordering. Imports now insert after the `__future__` block. (bc31d0c)
- **Silent refusals in four transform sidecars.** `pep585_generics`, `pep604_optional_union`, `datetime_utc_alias`, and `callback_to_async_await` previously refused some candidates without emitting any `precondition` record — users saw "detected, but nothing changed" with no explanation. Each refusal path now records `{id, satisfied: false, reason}`. (186d714)
- **`manual_typecheck_to_hints` was the silently-silent sidecar.** The Bug #3 fix above missed this transform. The Ansible trial showed 16 of 20 files with findings produced zero precondition records. Every refusal path now emits one; gate on "function contains an `isinstance(Name, Name)` call" prevents noise from unrelated siblings; nested-def scan stops at function boundaries to avoid false-positive outer-function records. Net effect on Ansible: 16 silent files → 0; 4 records → 87, covering all 20 files. (closes #57; PR #58)

### Internal

- Operations scaffolding under `.claude/` — 10 senior subagent personas, 3 project slash commands (`/review`, `/check-locked`, `/new-transform`), three hooks (commit-message validation, locked-file write block, post-write auto-format), CODEOWNERS, ARCHITECTURE.md, GLOSSARY.md, RUNBOOK.md, CODE_STYLE.md, COMMIT_CONVENTIONS.md, PRD/Plan/ADR templates. Developer-facing only — does not change library behaviour.
- New `docs/reference/performance.mdx` and `docs/reference/citations.mdx` pages, wired into Mintlify nav.
- README rewritten in a tighter prose-led style with a 1500×880 animated SVG banner; the demo gif still ships under `docs/assets/`.

### Known follow-ups (not blocking this release)

- `manual_typecheck_to_hints` now records why it refuses, but on Ansible it still rewrites 0 of 20 files — the dominant refusal is "function body has more than one statement" (e.g. docstring + dispatcher, or dispatcher + raise fallthrough). Expanding the rewriter to handle those shapes is tracked as #59 for a future release.
- Eight new transform candidates derived from a deeper Ansible scan (PEP 526 type-comment → annotation, TOCTOU-safe `makedirs`, redundant `(object)` base, subprocess legacy → `run`, `imp` → `importlib`, and three more) are filed as #62–#69 for v0.3 / v0.4 prioritisation.

---

## [0.2.3] — 2026-05-27

Ten new deterministic transforms — six for Python, four for TypeScript — roughly doubling Refactron's transform coverage. Adds the `pythonVersion` config key for safe version-gated rewrites.

### Added

- **Python — `super_no_args`** — drop redundant explicit class/self args from `super()` calls.
- **Python — `lru_cache_to_cache`** — `@functools.lru_cache(maxsize=None)` → `@functools.cache` (≥ 3.9).
- **Python — `pep585_generics`** — `typing.List` / `Dict` / `Tuple` → built-in `list` / `dict` / `tuple` (≥ 3.9, or `from __future__ import annotations`); drops now-unused `typing` imports; refuses when runtime type evaluation is in use.
- **Python — `pep604_optional_union`** — `Optional[X]` → `X | None`, `Union[A, B]` → `A | B` (≥ 3.10, or `from __future__ import annotations`); same runtime-type-eval safety as `pep585_generics`.
- **Python — `datetime_utc_alias`** — `datetime.timezone.utc` → `datetime.UTC` (≥ 3.11; no `__future__` override since this is a runtime attribute).
- **Python — `yield_from_for_loop`** — `for x in y: yield x` → `yield from y` when the loop has no other body. Refuses inside `async def` (a CPython compile-stage SyntaxError that LibCST's parser does not catch).
- **TypeScript — `indexof_to_includes`** — `arr.indexOf(x) !== -1` / `>= 0` / `> -1` → `arr.includes(x)`; `=== -1` / `< 0` → `!arr.includes(x)`. Type-aware via ts-morph (String / Array / ReadonlyArray receivers only). Gated on tsconfig target ≥ ES2016.
- **TypeScript — `object_assign_to_spread`** — `Object.assign({}, a, b)` → `{ ...a, ...b }`. Preserves first-arg literal properties; inlines object-literal sources; refuses on spread-element arguments. Gated on tsconfig target ≥ ES2018.
- **TypeScript — `string_concat_to_template_literal`** — `"Hello " + name + "!"` → `` `Hello ${name}!` ``. ts-morph type-checks every operand; refuses on `any` / `unknown` / non-`string|number|boolean`. Gated on tsconfig target ≥ ES2015.
- **TypeScript — `vue_set_delete_to_assignment`** — `Vue.set` / `this.$set` → direct assignment; `Vue.delete` / `this.$delete` → `delete obj.k`. `.js` / `.ts` only (Vue SFC parser deferred to v0.4). Refuses `delete` in expression context (return-value semantics differ). Caveat shipped in suggestion text: in Vue 2 codebases this is a semantic change because direct assignment isn't reactive for new keys.
- **Configuration — `pythonVersion`** — pin the Python target for version-gated transforms; auto-detected from `pyproject.toml`'s `requires-python` when not set.

### Changed

- **Engine composition (PR #38)** — multi-transform composition is now order-stable: when several transforms touch the same file, each emits its own `FileChange` carrying the cumulative content (last per path is the one written to disk). Fixes a silent-data-loss bug where only the LAST transform's rewrite survived under `run --apply`.

### Internal

- Shared sidecar helpers: `src/transform/transforms/python/_py/_python_version.py` (version gating), `_typing_cleanup.py` (PEP 585/604 shared logic).
- Shared TS helper: `src/transform/transforms/typescript/_tsconfig.ts` (tsconfig target resolution with `extends` chain support, including TS 5.0+ array-extends and JSONC stripping).

## [0.2.2] — 2026-05-18

Quality-of-life release for the analyze → run → document pipeline: boxed
CLI output, a real `rollback` command, and a much more efficient
`document`. All changes landed via PR #31.

### Added

- **Bordered table output** — `analyze` renders one box per file plus boxed TRANSFORMS / BY TRANSFORM / SUMMARY blocks; `run --dry-run` is restructured to match, with a CHANGES table and a four-sided diff box per file
- **`rollback` command** — undo an applied refactor or `document` run; operation journal with LIFO undo, drift-safe, `--all` / `--force` / `--dry-run`
- **`run --apply` live progress** — gate-by-gate status and per-file verify/apply detail; batch-first verification with a per-file fallback when the batch fails
- **`run --apply` short-circuit** — exits early with a clear message when no test runner is detected, instead of silently skipping the test gate
- **Full report saved to disk** — `analyze` and `run --dry-run` write the complete report to `.refactron/reports/` so long output survives terminal scrollback
- **`document` enrichments** — inline comments, a per-run modernization report under `docs/refactron/`, and a post-apply syntax re-check

### Changed

- **`document` is far more efficient** — docstring requests are batched with bounded concurrency and token-aware rate limiting; the LLM call count is now O(source tokens / batch budget) instead of O(symbols)

### Fixed

- **`document` produced zero docstrings on large files** — batches were sized by input tokens only, so dozens of symbols packed into one request whose combined response overran the completion cap and truncated mid-object. Batches are now also capped by response size, and `parseBatchDocstrings` salvages every complete entry from a truncated reply
- **`document` six-quote docstring bug** — `""""""…""""""` produced by a contradictory prompt plus unconditional quote wrapping
- **`document` rate-limited runs ground on for minutes** — each LLM call is paced once, not re-paced on every retry
- **`document` report / CHANGELOG paths** — normalized to forward slashes (were OS-native `\` on Windows, breaking the markdown and the Windows CI leg)
- **`analyze` old-string-format line numbers** — multi-line `%` / `.format()` findings now anchor on the operator, not the opening string quote that can sit many lines above
- **`analyze` over-reported `manual_typecheck_to_hints`** — no longer flags an isinstance chain on an already-annotated parameter, which the transform always skips
- **`deprecated_api_requests_to_httpx` emitted runtime-broken code** — a blind `requests.X → httpx.X` rename produced non-existent names (`httpx.ConnectionError`) and wrong types (`httpx.Timeout` is a config class). The transform now refuses files that use `requests` API which is not a safe httpx drop-in
- **`analyze` "Fixable N/N"** — replaced with an honest auto-fix-candidate count that defers the real number to `run --dry-run`
- **vitest per-test timeout** — corrected the config key (`timeout` → `testTimeout`); Python LibCST tests no longer flake against the 5 s default

## [0.2.1] — 2026-05-16

Patch release. Fixes a crash on large source files and lands two
transform-coverage improvements surfaced by the comparison benchmark.

### Fixed

- **`analyze` crashed on files larger than ~32 KB** — tree-sitter's native binding rejects a string input past ~32 KB with `Error: Invalid argument`, aborting the whole run. Parsing now uses tree-sitter's callback-input form, which streams the source in chunks and has no size cap. A single unparseable file is also skipped instead of aborting the run (PR #29)
- **`var_to_const_let` dropped whole files** — the hoisting and reassignment checks matched identifiers by text across the entire file, so two functions each declaring a same-named `var` tripped a false-positive and the transform skipped the file. Reference resolution is now scope-correct, and for-loop `var i` initializers are covered (PR #27)

### Changed

- **`format_to_fstring` now converts the full printf grammar** — `%d`, `%.2f`, `%x`, `%o`, `%e`, `%g`, width and precision specifiers, and `%%`. Previously only plain `%s` was handled. Mapping `%(name)s`, non-literal targets, and dynamic `*` widths are still conservatively skipped (PR #27)

## [0.2.0] — 2026-05-15

First public release of the v2.0 deterministic-refactoring rebuild.

### Added

- **Engine** — 10 deterministic AST transforms (5 Python via LibCST, 5 TypeScript via ts-morph) with cross-file preconditions
- **3-gate verification** — syntax + imports + tests on a shadow tree, atomic batch write or rollback (PRs #7, #8, #11, #13, #15)
- **Documentation engine** — Step 4 of the pipeline; the only LLM-touching component, runs only on already-verified diffs (PR #15)
- **5 LLM providers** for `document`: Ollama (local default — for the trust-conscious), Groq (BYOK fast), OpenAI, Anthropic, Backend (managed via api.refactron.dev for Pro users) (PR #22)
- **CLI output redesign** — by-file findings with code excerpts (analyze), per-file unified diffs (run --dry-run), gate-by-gate progress + structured failure surface (run --apply) (PR #19)
- **Authentication** — OAuth device flow with `REFACTRON_TOKEN` env var support; long-lived API keys for stay-logged-in semantics (PRs #13, #25)
- **`.refactronrc.json` config** — cosmiconfig + ajv schema validation; `transforms`, `exclude`, `testCmd`, `confidence`, `dryRun`, `documentation` (PRs #13, #20, #22)
- **Performance** — per-file parallelization in plan step, 3× speedup on python-legacy-mini (PR #23)
- **Mintlify documentation site** with full transform catalog, safety model diagram, FAQ, citations
- **Reproducible perf bench** infrastructure at `bench/`

### Changed

- REPL output history rendered via Ink `<Static>` to eliminate whole-screen flicker (PR #24)
- Spinner reduced from 80ms tick + per-char shimmer to 250ms tick + single brand color (~50 → ~4 ANSI escapes/sec) (PR #24)
- `RefactronRc.documentation.provider` defaults to `'backend'` so authenticated Pro users get LLM docs out-of-the-box (PR #22)

### Fixed

- REPL `clear` now wipes the terminal viewport, not just React state (PR #24)
- REPL `document` defaults to the active session's analyze target (was reading stale `last-apply.json` from cwd) (PR #22)
- `RefactronRc.exclude` field is now wired into discovery (was dead code since Week 5) (PR #20)
- Run `--apply <file>` parser stops eating the path argument (PR #17)
- REPL `document` output no longer vanishes into Ink's render buffer (PR #18)
- Verify failure surface no longer drops vitest's FAIL section (was front-slicing 4000 chars) (PR #19)
- Findings rendered in source order within each file, not detector-emission order (PR #20)
- CHANGELOG written next to the changed files' project marker, not to cwd (PR #22)
- Cross-platform: Windows path separators normalized in formatters; Node 18 execa.timedOut wall-clock derivation (PR #19, #20)

### Documentation

- SECURITY.md with disclosure policy + threat model
- 30-second demo GIF in README
- 13 docs site pages (Safety Model, 10 transform pages, CLI Reference, Configuration, FAQ, Why No LLM)
- ADRs 1–10 covering every weekly architecture decision

### Honest limitations

- No Ruby / Go / Rust adapters in 0.2; multi-language is post-launch
- Documentation engine requires a reachable LLM provider (graceful skip otherwise)
- Self-analysis on Refactron's own repo fails the test gate by design (mutating fixtures breaks meta-tests) — see `docs/known-limitations`

---

## [0.1.0-beta.2] — 2026-04-05

### Added

**Interactive Issue Browser**

- `analyze` now opens the interactive issue browser automatically after scanning — no extra command needed
- Full-screen Ink TUI: paginated issue list, detail panel, diff preview, filter mode
- `a` — fix selected issue in place (atomic write + backup, marks ✔, stays in browser)
- `A` — fix all fixable issues in one pass with live `fixing N/M…` progress
- `d` — dry-run diff preview (12 lines, Esc to dismiss)
- `v` — verify a fixed issue's file (only available after fixing, shows ✓ safe / ✘ blocked)
- `/` — real-time filter by message, file, severity, or type
- `j`/`k` and `↑`/`↓` — navigation; `g`/`G` — jump to first/last; `PgUp`/`PgDn` — page
- Status messages auto-dismiss after 3s

**Work Sessions**

- `WorkSessionManager` — persists full `CodeIssue[]` to `.refactron/work-sessions/{id}.json`
- `autofix` and `verify` commands operate on the active session — no re-scan needed
- `session list` — list all saved sessions; `session <id>` — load and activate
- `issues` command — open browser on any active session

**CLI UX**

- Slash command picker: typing `/` in the prompt shows a filterable command menu
- Ctrl+C double-press to exit: first press shows warning, auto-dismisses after 800ms
- `hint: <tip>` line below spinner rotates through random tips every 4s while a command runs
- Session header (`SessionHeader`) stays fixed at top — never scrolls away
- Terminal mouse scroll re-enabled (removed alternate screen buffer, runs on main screen)
- Mouse wheel no longer injects arrow keys into the REPL history

### Changed

- `analyze` returns `openBrowser: true` — browser launches immediately after scan summary
- StatusLine footer bar removed — cleaner UI
- `logout` exits the session on completion
- Git subprocess calls batched via `--stdin` (1 call vs N per-file)
- `isGitRepo()` result cached; temporal profiles built in parallel

### Fixed

- `SessionHeader` was rendering inside `Static` (scrolled away); moved to live Ink tree
- Single-extension glob `**/*.{py}` edge case replaced with `**/*.py`
- Second `analyze` run returning 0 files (`.refactron/` JSON picked up by glob); added ignore
- Unused vars lint errors across REPL, IssueBrowser, LoginFlow, session types

---

## [0.1.0-beta.1] — 2026-04-04

Initial beta release.

### Added

**Core**

- `CodeIssue` model with mandatory `BlastRadius` — every issue carries a non-optional impact score
- `ILanguageAdapter` interface — language-agnostic contract for all language-specific work
- `RefactronConfig` with YAML loader and deep-merge defaults (`refactron.yaml`)

**Blast Radius Engine**

- Transitive import graph traversal (`InMemoryImportGraph`)
- Function-level call graph (`InMemoryCallGraph`)
- `BlastRadiusAnalyzer` — 0–100 weighted score (files 40%, functions 40%, test coverage gap 20%)
- 5 blast levels: `trivial`, `low`, `medium`, `high`, `critical`

**Verification Engine**

- Blast-radius-aware check selection — trivial runs syntax only, critical runs all three checks
- `SyntaxCheck`, `ImportsCheck`, `TestGateCheck` delegates
- 45s timeout for standard checks, 120s for critical blast
- Atomic file writes (temp → rename) with Windows fallback

**Analysis Engine (7 Analyzers)**

- `SecurityAnalyzer` — SQL injection, `eval()`, hardcoded secrets, `exec()`
- `ComplexityAnalyzer` — cyclomatic complexity (default threshold: 10)
- `CodeSmellAnalyzer` — long methods (default: 50 lines)
- `DeadCodeAnalyzer` — unreachable code after control flow statements
- `TypeHintsAnalyzer` — missing Python return types, TypeScript explicit `any`
- `DependenciesAnalyzer` — unused imports
- `PerformanceAnalyzer` — list concat in loops, `await` inside loops

**Language Adapters**

- `PythonAdapter` — syntax via `ast.parse`, imports via `py_compile`, tests via `pytest`
- `TypeScriptAdapter` — syntax via TypeScript compiler API, tests via `vitest`/`jest`
- `AdapterRegistry` — auto-detection by file extension and project structure

**AutoFix Engine (14 Fixers)**

- `UnusedImportsFixer`, `TrailingWhitespaceFixer`, `DeadCodeFixer`
- `SortImportsFixer`, `NormalizeQuotesFixer`, `TypeHintsFixer`
- `DocstringsFixer`, `SimplifyBooleanFixer`, `UnusedVariablesFixer`
- `FixIndentationFixer`, `MissingCommasFixer`, `RemoveDebugFixer`
- `MagicNumbersFixer`, `ConvertFstringFixer` (flag-only in MVP)

**Pipeline**

- `FixQueue` — enqueue, status transitions (PENDING → APPLIED/BLOCKED/SKIPPED)
- `SessionManager` — state machine (ANALYZED → FIXING → FIXED → ROLLED_BACK)
- `SessionStore` — `.refactron/sessions/` JSON persistence
- `BackupManager` — per-session file backups enabling rollback
- `Orchestrator` — full analyze → fix → verify → atomic write pipeline

**Temporal Analysis**

- Git log parsing for change velocity (6-month window)
- Co-change pair detection (files that change together >50% of commits)
- Risk scoring: `DANGER`, `HIGH`, `MEDIUM`, `LOW`

**CLI**

- `refactron analyze` — scan with interactive Ink issue browser
- `refactron autofix` — fix with verification gate
- `refactron verify` — verify a single file
- `refactron status` — show session state
- `refactron rollback` — restore from backup
- `refactron diff` — show unified diff
- `--version` / `--help` fast paths (<10ms, no app load)

**Terminal UI (Ink)**

- `IssueList` — navigable list with blast radius display
- `IssueDetail` — expanded issue view
- `VerificationView` — live check progress
- `DiffView` — syntax-highlighted unified diff
- `BlastRadiusGraph` — ASCII impact visualization
- `StatusBar` — always-visible severity summary
- `ProgressBar` — animated scan progress

**CI/CD**

- GitHub Actions: CI (typecheck, lint, test matrix, build), release, security, nightly
- Dependabot weekly npm updates
- CodeQL analysis
- Nightly regression against 5 real-world repos (Django, Requests, FastAPI, Black, Flask)

### Technical Notes

- TypeScript 5.4, Node.js 18+, ESM (`"type": "module"`)
- `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`
- Ink 5 / React 18 terminal UI
- `"jsx": "react-jsx"` (automatic runtime — no `import React` required)
- 45 tests across 13 test files

---

## Upcoming

- Go language adapter
- JSON and SARIF output formats
- `--output <file>` flag for CI integration
- Semgrep integration for deeper security analysis
- Tree-sitter-based import graph (replaces regex heuristics)
- VS Code extension
