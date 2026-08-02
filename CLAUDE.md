# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Operations scaffolding (`.claude/` + repo root)

Route through these resources instead of redoing the work each session.

**Subagents (`.claude/agents/`)**: 11 senior personas (10+ yrs framing) for delegation. Each declares its peers under "Hand-offs."

| Agent                       | Use for                                                 |
| --------------------------- | ------------------------------------------------------- |
| `delivery-lead`             | Issue shaping, sizing, definition of done               |
| `principal-engineer`        | Architecture / locked-contract calls / breaking changes |
| `staff-code-reviewer`       | Adversarial pre-merge review                            |
| `security-engineer`         | Threat modeling, sidecar safety, supply chain           |
| `python-sidecar-specialist` | LibCST patterns, verify checks, refusal preconditions   |
| `typescript-architect`      | Verify engine, ts-morph, ESM, type-level safety         |
| `release-manager`           | Semver, changelog, npm + PyPI publish                   |
| `test-engineer`             | Red-first proof, fixtures, snapshot discipline          |
| `dx-engineer`               | Verdict output, CLI ergonomics, error messages, Ink TUI |
| `documentation-engineer`    | README, mdx, changelog tone, migrations                 |
| `performance-engineer`      | Throughput, sidecar latency, profiling                  |

Review and analysis roles (`staff-code-reviewer`, `principal-engineer`, `security-engineer`, `performance-engineer`) hold read-only tool grants: a reviewer that can edit stops arguing with itself and starts fixing, which is how review findings get quietly absorbed instead of reported.

**Issue-first workflow**

Work starts as an issue. The branch is named `<type>/<number>-<slug>`, and the PR closes the issue.

1. `/issue` shapes an intent into a well-formed issue (problem, evidence, acceptance criteria, non-goals) via `delivery-lead`, and files it.
2. `/start <number>` reads the issue, creates the branch, plans the approach, and begins test-first.
3. `/review` runs the three-lens parallel review (correctness, architecture, tests) against the current branch.
4. `/ship` verifies the work against its issue, runs the review, and opens the PR with `Closes #<n>`.

Use `/ship` instead of `gh pr create`. A branch with no issue behind it is work nobody agreed to.

**Slash commands (`.claude/commands/`)**

- `/issue`: shape an intent into a well-formed GitHub issue and file it (routes through `delivery-lead`).
- `/start <number>`: pick up an issue, branch for it, plan, begin test-first.
- `/review`: three-lens adversarial review of the current branch (correctness, architecture, tests), run in parallel.
- `/ship`: the pre-PR gate. Verify against the issue, run the review, open the PR.
- `/check-locked`: verify the locked-files invariant on the current branch.
- `/new-transform`: end-to-end transform scaffolding (migration mode).

**Rules**

- `CODE_STYLE.md`: concrete TS + Python rules
- `COMMIT_CONVENTIONS.md`: Conventional Commits + this repo's scope vocabulary + authorship rules

**Operations & navigation**

- `ARCHITECTURE.md`: engines, locked surfaces, pipeline, invariants
- `GLOSSARY.md`: blast radius, tier, sidecar, atomic write, precondition, gate, and the rest
- `RUNBOOK.md`: release, rollback, CVE response, snapshot regeneration

**Templates**: `docs/prd/_template.md`, `docs/plans/_template.md`, `dev-docs/decisions/_template.md` (each links real examples in this repo).

**Settings & hooks (`.claude/settings.json`, `.claude/hooks/`)**: team-wide permissions plus three live hooks:

- `block-dangerous-bash.sh` (PreToolUse:Bash): blocks `--no-verify`, `--force` push, `git reset --hard`, real `npm publish`, broad `rm -rf`
- `block-locked-file-writes.sh` (PreToolUse:Write|Edit): blocks edits to `src/contracts.ts`, `src/core/models.ts`, `src/adapters/interface.ts`
- `auto-format.sh` (PostToolUse:Write|Edit): runs prettier on supported files so format:check stays green
- `.githooks/commit-msg`: enforces COMMIT_CONVENTIONS (Conventional Commits shape, no AI names, no co-author trailers, 72-char subject cap). Activated by `npm install` via the `prepare` script.

**Ownership**: `.github/CODEOWNERS` auto-requests review on locked files, ADRs, ops scaffolding, and release-critical files.

When a non-trivial task arrives, the first move is usually: find or file the issue, pick the matching subagent, read the relevant rule doc, and start from the template, not from scratch.

## Common Commands

```bash
npm run build              # tsc --project tsconfig.build.json (chmods dist/cli/index.js)
npm run typecheck          # tsc --noEmit
npm run lint               # eslint, --max-warnings 0 (warnings fail)
npm run format             # prettier --write
npm run format:check       # CI-style prettier check

npm test                   # vitest run (full suite)
npm run test:watch         # vitest in watch mode
npm run test:coverage      # vitest with v8 coverage
npm run test:verification  # only tests/verification/

# Single test file / single case:
npx vitest run tests/unit/<file>.test.ts
npx vitest run tests/unit/<file>.test.ts -t "<case name substring>"

# Pre-publish chain (must all pass): clean, build, typecheck, lint, test
npm run prepublishOnly

# Run the CLI locally after build:
node dist/cli/index.js <command>
```

Requires Node.js 18+ and Python 3.8+ (for Python-adapter tests).

## Locked Contracts: Do Not Modify

- `src/core/models.ts`
- `src/adapters/interface.ts`

These define types every other module depends on. PRs that modify them are closed without review; changes require a major version bump and coordinated migration. If a contract change seems necessary, open an issue first.

## Engine Contracts

`src/contracts.ts` is the locked engine surface. It defines the four engine interfaces (`Analyzer`, `Refactorer`, `Verifier`, `Documenter`) along with `RefactorPlan`, `FileChange`, `GateResult`, and the 20 `TransformId` literals. Adding a `TransformId` literal is additive; structural changes require a major version bump.

`src/core/models.ts` and `src/adapters/interface.ts` remain locked and are classified as legacy. They back the blast-radius analyze path and still compile.

Both surfaces coexist. New engine code targets `contracts.ts`; the legacy engines keep compiling against `models.ts`. Do not import from both surfaces in the same file: pick one side of the boundary per module.

`VerdictReport` (`src/verify/verdict-fuse.ts`) is not in `contracts.ts` but is equally public: the MCP tool and `verify-diff --json` serialize it verbatim, and it carries `reportVersion` so consumers storing reports know which shape they hold. Additive fields are safe; renames, removals, and retypes are breaking.

## Blast Radius Invariant

Every `CodeIssue` produced anywhere in the codebase MUST carry a non-null `blastRadius` of shape `{affectedFiles, affectedFunctions, affectedTestFiles, score, level}`. Tests or analyzers that emit issues without it will be rejected.

- Score formula: `files (40%) + functions (40%) + test-coverage gap (20%)`
- The legacy verification engine scales by `level`:
  - `trivial` maps to syntax only
  - `low` / `medium` / `high` map to syntax + imports + tests (45s timeout)
  - `critical` maps to syntax + imports + tests (120s timeout)

That gating belongs to the legacy `src/verification/` engine; do not bypass it there. The `verify-diff` and MCP path is separate: it always runs all three gates in order and applies a flat 600s default test timeout (`src/verify/runners/detect.ts`).

## Architecture (the big picture)

- **`src/verify/`**: the verification engine. Shadow tree (`shadow-tree.ts`), diff intake and rejection (`diff-input.ts`), the three gates (`gates/`), per-language checks (`checks/`, including the Python sidecars under `checks/_py/`), statement mapping and coverage attribution, and `verdict-fuse.ts` (pure fusion into `SAFE` / `UNSAFE` / `UNPROVEN`). Batch writes go through `atomic-batch-writer.ts`.
- **`src/mcp/`**: the stdio MCP server (`server.ts`) exposing `verify_change`, which returns the same report the CLI does.
- **`src/core/`**: locked legacy types (`models.ts`), config loader (`config.ts`), and `orchestrator.ts` that wires the migration pipeline.
- **`src/adapters/`**: language-agnostic boundary via `ILanguageAdapter`. Python uses a subprocess; TypeScript uses the compiler API. **All language-specific logic stays inside an adapter**: the verification and analysis engines must remain language-agnostic.
- **`src/analysis/`**: blast-radius scoring (`blast-radius.ts`), `import-graph.ts` (file-level reverse imports), `call-graph.ts` (function-level), `temporal.ts` (git history), and the analyzer set under `analyzers/`.
- **`src/verification/`**: legacy blast-radius-aware check selection (`engine.ts`); single-file writes go through `atomic-writer.ts` (temp file, then rename) so partial writes never occur.
- **`src/autofix/`**: fixer-based. Each extends `BaseFixer` (`fixers/base.ts`), declares `supportedIssueTypes`, and is registered in `autofix/engine.ts`.
- **`src/pipeline/`**: session state machine, `.refactron/` persistence (`store.ts`), and fix queue.
- **`src/infrastructure/`**: backup/rollback, diff generation, git log + co-change.
- **`src/cli/`**: `index.ts` is a fast-path dispatcher (target under 10ms for `--version`); `app.tsx` routes to Ink command components under `commands/`.
- **`src/ui/`**: Ink terminal UI components.

Shadow-tree isolation, atomic writes, honest verdict degradation, and the locked adapter interface are the properties the rest of the system relies on. Preserve them.

## Where to Register New Things

- **Analyzer**: add `src/analysis/analyzers/<name>.ts` extending `BaseAnalyzer`, register in `src/analysis/engine.ts`, add a config key in `src/core/config.ts` and `refactron.yaml`, test in `tests/unit/analyzers.test.ts`.
- **Fixer**: extend `BaseFixer` in `src/autofix/fixers/`, declare `supportedIssueTypes`, register in `src/autofix/engine.ts`, test in `tests/unit/autofix-engine.test.ts`.
- **Language adapter**: implement `ILanguageAdapter` from `src/adapters/interface.ts`, register in `src/adapters/registry.ts`. Keep all language-specific logic inside the adapter.

## Conventions

- ESM project (`"type": "module"`); use ESM imports with the `.js` extension.
- Vitest only; never import from `jest`.
- ESLint runs with `--max-warnings 0`; warnings fail CI.
- Conventional Commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:` (scopes encouraged, e.g. `fix(python-adapter): ...`).
- Follow TDD: write the failing test first, prove it red against `main`, then implement.
- A test whose prerequisite may be missing uses `it.skipIf`, never an early return. An early return reports PASSED and proves nothing.
