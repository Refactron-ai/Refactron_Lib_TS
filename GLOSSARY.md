# Glossary

Terms used throughout the Refactron codebase. If a term you encounter isn't here, that's a glossary bug — open an issue.

---

**Adapter** — a language-specific implementation of `ILanguageAdapter` (`src/adapters/interface.ts`). Hides parser/AST differences behind a uniform interface so analysis and verification stay language-agnostic. Refactron has `python` (subprocess + LibCST) and `typescript` (in-process ts-morph). Locked interface.

**Analyze report** — the output of `RefactronAnalyzer.analyze()` / `analyzeExtended()`. A list of `Finding`s grouped by transform, with blast-radius and tier metadata. Persisted in `.refactron/` and consumed by the refactorer to build a plan.

**Apply** — the act of writing a `RefactorPlan` to disk. Goes through the 3-gate verifier first and the atomic batch writer second. If any gate fails, nothing is written.

**Atomic write** — writing a file by `write-to-temp → fsync → rename(temp, dest)`. Atomic at the filesystem level (POSIX `rename(2)`, equivalent on Windows). All Refactron writes go through `src/infrastructure/atomic-writer.ts`. Bypassing this is a CR-block.

**Batch writer** — wraps `atomic-writer` to write N files atomically as a group. Preflight checks (parent dirs exist, no path escapes project root) → two-phase rename (all temps first, then all renames). Partial failure rolls back every rename done so far.

**Blast radius** — a per-issue estimate of how far a fix's effect propagates. Required on every `CodeIssue`. Shape: `{affectedFiles, affectedFunctions, affectedTestFiles, score, level}`. Computed from import-graph + call-graph + test coverage. Drives verification depth via `level`.

**Confidence** — per-detector estimate of how likely a finding is a true positive. `low` / `medium` / `high`. Surfaced in `analyze`; can be filtered with `--confidence=<level>`.

**Contract (v2.0)** — the four engine interfaces in `src/contracts.ts`: `Analyzer`, `Refactorer`, `Verifier`, `Documenter`. Plus `RefactorPlan`, `FileChange`, `TransformId`. Locked.

**Detector** — code that scans source for a transform's candidates and emits `Finding`s. Lives in `src/analyze/detectors/<lang>/<name>.ts`. Uses tree-sitter on the Python side, ts-morph on the TypeScript side. Must match its sidecar's accept predicate exactly — drift causes silent refusals (the #57 class of bug).

**Documenter** — the engine that generates docstrings (LLM-backed) and CHANGELOG entries (deterministic). Lives in `src/document/`. Runs after `apply`; never blocks the refactor.

**Drift** — when two pieces of logic that should match (detector ↔ sidecar; CLI flag ↔ engine option; doc page ↔ source) silently disagree. Caught by `tests/unit/cli/transform-ids-drift.test.ts` for the TRANSFORM_ID set; other drifts are caught by code review.

**Engine** — a major subsystem implementing one of the v2.0 contracts. Refactron has four: analyze, transform (refactor), verify, document.

**Finding** — a detector's report that a file has a candidate for a specific transform. Carries file path, line, transform id, remediation minutes, confidence, blast radius. Becomes a planned `FileChange` once the refactorer processes it.

**Fixer** — legacy autofix abstraction (`src/autofix/fixers/`). Each extends `BaseFixer`, declares `supportedIssueTypes`. Predates the v2.0 transform model; new work uses transforms, not fixers.

**Gate** — one stage of the verification pipeline. Refactron has three: syntax (parses cleanly?), imports (do all imports resolve in the new state?), tests (do the project's tests pass in a shadow tree with the new files?). Higher-blast-radius changes run more gates; trivial changes run only syntax.

**Locked file** — a source file whose interface is frozen. Modifications require an ADR + major version bump + migration plan. Currently: `src/contracts.ts`, `src/core/models.ts`, `src/adapters/interface.ts`. PRs that touch these without an ADR get closed.

**Plan** — a `RefactorPlan` produced by `Refactorer.plan()`. Contains `changes: FileChange[]` and `preconditions: Precondition[]`. The plan is what gets verified and applied; nothing is written until apply.

**Playground** — `playground/` directory. Real-world trial corpora (Ansible checkout, large-Python, legacy-TS, etc.). Used to validate transforms empirically. **NOT a release surface.** Mutations to `playground/` are bugs; transforms run in `/tmp/` copies for testing.

**Precondition** — a record emitted by a transform attempt: `{id, satisfied, reason?}`. `satisfied: true` records a successful change; `satisfied: false` records a refusal with a reason. **Every refusal path must emit one** — silent refusals are the #57 class of bug.

**Refactorer** — the v2.0 engine that takes an `AnalysisReport` and produces a `RefactorPlan`. Lives in `src/transform/engine.ts`. Composes transforms per-file in `TRANSFORM_ORDER`.

**Refactron config** — `refactron.yaml` at the project root. Controls which transforms run, confidence threshold, Python version target, test command override, etc. Schema in `src/core/config.ts`.

**Remediation minutes** — per-finding estimate of how long a human fix would take. Summed to produce the "minutes saved" headline in `analyze`. Defined per-transform in `src/analyze/sqale.ts`.

**Shadow tree** — a hardlinked-or-copied mirror of the project used during verification. The verifier writes the plan into the shadow tree (never the real tree) and runs syntax/import/test checks there. Built in `src/verify/` (post-v2.0); legacy path in `src/verification/`.

**Sidecar** — a Python script invoked as a subprocess by a `python` adapter transform. Lives in `src/transform/transforms/python/_py/<name>.py`. Reads source path from `sys.argv[1]`, emits `ok`/`new_content`/`preconditions` via `_base.emit`. Stdlib + LibCST only.

**Subagent** — a Claude Code subagent definition in `.claude/agents/<name>.md`. Refactron ships 10+ senior personas (principal-engineer, staff-code-reviewer, etc.) that are routable via the Agent tool's `subagent_type` parameter.

**Tier** — a transform's classification: `debt` / `modernization` / `style`. Defined in `TIER_BY_TRANSFORM` in `src/cli/v2-adapters.ts`. Drives the `BY TIER` section in `analyze` output.

**Transform** — a code-rewriting operation: detect candidates, plan changes, verify, write. Identified by a `TransformId` literal (in the locked `src/contracts.ts` union). Refactron ships 20+ transforms; new ones are added via `.claude/commands/new-transform.md`.

**TRANSFORM_ORDER** — the canonical exec order of all transforms, exported from `src/transform/engine.ts`. The CLI's `--transforms=all` and the REPL's transform list both derive from this — drift between them is a tracked bug class (#49).

**Verify / 3-gate** — the verification pipeline: syntax → imports → tests. Gates run in a shadow tree, gated by blast-radius level. A plan only applies if all gates pass.
