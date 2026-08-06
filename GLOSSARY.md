# Glossary

Terms used throughout the Refactron codebase. If a term you encounter isn't here, that's a glossary bug — open an issue.

Terms belonging to the refactoring product (transform, fixer, blast radius, tier, adapter, plan, finding, and the rest) left in 0.4.0 along with the code. They live in the archived repository.

---

**Attribution** — deciding whether a test run actually executed the lines a diff changed. Done by mapping each changed line to its enclosing AST statement (`src/verify/statement-map.ts`) and asking whether coverage.py recorded that statement (`src/verify/coverage-attribution.ts`). Containment, not line numbers: coverage.py reports a multi-line statement at its first line.

**Contract** — `src/contracts.ts`, the locked engine surface: the engine interfaces plus `RefactorPlan`, `FileChange`, `GateResult` and the `TransformId` union. `TransformId` still lists 20 transform literals with no transforms behind them; narrowing it is a breaking change and waits for a major.

**Drift** — when two pieces of logic that should match silently disagree: help text against the dispatcher, a doc page against source, an inlined constant against its generator. Caught by `tests/unit/cli/help-drift.test.ts` for the CLI surface. The class is worth naming because a drift test that itself cannot fail is the same bug one level up.

**False SAFE** — reporting `SAFE` for a change that is not safe. The only unforgivable defect in this product: every other bug is a bug, this one removes the reason to run the tool. Two have shipped, both fixed in 0.3.1, both caused by coverage measuring a different program than the tests gate ran.

**Gate** — one stage of the verification pipeline: syntax (does it parse?), imports (do they resolve?), tests (does the suite pass in the shadow tree?). All three always run, in order. They are no longer selected by blast radius; that scaling left with the legacy engine.

**Honest degradation** — when something cannot be measured, the verdict moves toward `UNPROVEN`, never toward `SAFE`. Coverage attestation is coverage.py only, so a non-Python or mixed diff returns `UNPROVEN` rather than a guess.

**Locked file** — a source file whose interface is frozen. Modifications require an ADR, a major version bump and a migration plan. Currently just `src/contracts.ts`. PRs that touch it without an ADR get closed.

**Measurement parity** — the rule that the coverage run must be observationally equivalent to what the tests gate actually ran. Enforced in `toCoverageRunArgs` (`src/analyze/coverage/python-line-coverage.ts`), which declines rather than approximating. Both shipped false SAFEs were parity failures.

**Precondition** — a record of a refusal: `{id, satisfied, reason?}`. Every refusal path must emit one, because a silent refusal is indistinguishable from success.

**Sidecar** — a Python script invoked as a subprocess by a verification check. Lives in `src/verify/checks/_py/<name>.py`, stdlib only. Copied into `dist/` by `scripts/postbuild.mjs`, which asserts they arrived: a missing sidecar is silent at build time and fatal at runtime.

**Shadow tree** — a copy of the project into which the diff is applied, under the system temp directory. Every gate runs there. Nothing in this codebase writes to the caller's working tree, in any path, for any verdict.

**Shadow bypass** — when the test suite loads a different copy of the code than the one being verified, usually an installed or editable package. Detected by a changed file being absent from `measuredFiles`, which floors the verdict at `UNPROVEN` with a reason naming the remedy. Without this guard an editable install produces a confident `SAFE` for code no test touched.

**Subagent** — a Claude Code subagent definition in `.claude/agents/<name>.md`. Refactron ships senior personas (principal-engineer, staff-code-reviewer, test-engineer and others) routable via the Agent tool's `subagent_type` parameter.

**Verdict** — `SAFE`, `UNSAFE` or `UNPROVEN`, produced by `fuseVerdict` (`src/verify/verdict-fuse.ts`) from gate results plus coverage. A pure function with no I/O, so the decision is testable in isolation. `UNPROVEN` exits 0: it is a warning, not a rejection.

**VerdictReport** — the serialized result, emitted verbatim by both `verify-diff --json` and the MCP `verify_change` tool. A public contract carrying `reportVersion` so stored reports are readable later. Additive fields are safe; renames, removals and retypes are breaking.
