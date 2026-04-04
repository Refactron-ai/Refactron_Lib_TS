# Changelog

All notable changes to Refactron are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
