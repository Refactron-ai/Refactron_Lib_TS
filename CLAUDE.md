# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Operations scaffolding (`.claude/` + repo root)

Route through these resources instead of redoing the work each session:

- **Subagents (`.claude/agents/`)**: senior personas for delegation. `principal-engineer` (architecture/locked-contract calls), `staff-code-reviewer` (adversarial pre-merge review), `security-engineer` (threat modeling, sidecar safety), `python-sidecar-specialist` (LibCST, refusal preconditions), `typescript-architect` (ts-morph, ESM, type-level safety), `release-manager` (semver, changelog, npm publish), `test-engineer` (TDD discipline, fixtures, snapshot review).
- **Slash commands (`.claude/commands/`)**: `/review` (dispatch the code reviewer on the current branch), `/check-locked` (verify the locked-files invariant), `/new-transform` (end-to-end transform scaffolding).
- **Rules**: `CODE_STYLE.md` (TS + Python concrete rules), `COMMIT_CONVENTIONS.md` (Conventional Commits scope vocabulary + repo-specific authorship rules).
- **Templates**: `docs/prd/_template.md`, `docs/plans/_template.md`, `dev-docs/decisions/_template.md` (ADR). Use these to start new work; don't invent ad-hoc structures.
- **Settings (`.claude/settings.json`)**: team-wide permissions including a `deny` rule on the locked files and on `playground/` mutations.

When a non-trivial task arrives, the first move is usually: pick the matching subagent, read the relevant rule doc, and start from the template — not from scratch.

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

# Pre-publish chain (must all pass): clean → build → typecheck → lint → test
npm run prepublishOnly

# Run the CLI locally after build:
node dist/cli/index.js <command>
```

Requires Node.js ≥ 18 and Python 3.8+ (for Python-adapter tests).

## Locked Contracts — Do Not Modify

- `src/core/models.ts`
- `src/adapters/interface.ts`

These define types every other module depends on. PRs that modify them are closed without review; changes require a major version bump and coordinated migration. If a contract change seems necessary, open an issue first.

## v2.0 Engine Contracts

`src/contracts.ts` is the new locked engine surface for the v2.0 rebuild. It defines the four engine interfaces (`Analyzer`, `Refactorer`, `Verifier`, `Documenter`) along with `RefactorPlan`, `FileChange`, and the ten `TransformId` literals. Modifications require a major version bump.

`src/core/models.ts` and `src/adapters/interface.ts` remain locked but are now classified as legacy. They back the existing blast-radius engines and continue to compile until the Weeks 2–4 migration retires them.

During Weeks 2–4, new engine code targets `contracts.ts` while existing engines keep compiling against `models.ts`. Do not import from both surfaces in the same file — pick one side of the migration boundary per module.

## Blast Radius Invariant

Every `CodeIssue` produced anywhere in the codebase MUST carry a non-null `blastRadius` of shape `{affectedFiles, affectedFunctions, affectedTestFiles, score, level}`. Tests or analyzers that emit issues without it will be rejected.

- Score formula: `files (40%) + functions (40%) + test-coverage gap (20%)`
- Verification scales by `level`:
  - `trivial` → syntax only
  - `low` / `medium` / `high` → syntax + imports + tests (45s timeout)
  - `critical` → syntax + imports + tests (120s timeout)

The verification engine selects checks based on `level`; do not bypass this gating.

## Architecture (the big picture)

- **`src/core/`** — locked types (`models.ts`), config loader (`config.ts`), and `orchestrator.ts` that wires the full pipeline.
- **`src/adapters/`** — language-agnostic boundary via `ILanguageAdapter`. Python uses a subprocess; TypeScript uses the compiler API. **All language-specific logic stays inside an adapter** — the verification and analysis engines must remain language-agnostic.
- **`src/analysis/`** — blast-radius scoring (`blast-radius.ts`), `import-graph.ts` (file-level reverse imports), `call-graph.ts` (function-level), `temporal.ts` (git history), and the analyzer set under `analyzers/`.
- **`src/verification/`** — blast-radius-aware check selection (`engine.ts`); writes go through `atomic-writer.ts` (temp file → rename) so partial writes never occur.
- **`src/autofix/`** — fixer-based: each extends `BaseFixer` (`fixers/base.ts`), declares `supportedIssueTypes`, and is registered in `autofix/engine.ts`.
- **`src/pipeline/`** — session state machine, `.refactron/` persistence (`store.ts`), and fix queue.
- **`src/infrastructure/`** — backup/rollback, diff generation, git log + co-change.
- **`src/cli/`** — `index.ts` is a fast-path dispatcher (target <10ms for `--version`); `app.tsx` routes to Ink command components under `commands/`.
- **`src/ui/`** — Ink terminal UI components.

Atomic writes, blast-radius gating, and the locked adapter interface are the three properties the rest of the system relies on — preserve them.

## Where to Register New Things

- **Analyzer** — add `src/analysis/analyzers/<name>.ts` extending `BaseAnalyzer`, register in `src/analysis/engine.ts`, add config key in `src/core/config.ts` and `refactron.yaml`, test in `tests/unit/analyzers.test.ts`.
- **Fixer** — extend `BaseFixer` in `src/autofix/fixers/`, declare `supportedIssueTypes`, register in `src/autofix/engine.ts`, test in `tests/unit/autofix-engine.test.ts`.
- **Language adapter** — implement `ILanguageAdapter` from `src/adapters/interface.ts`, register in `src/adapters/registry.ts`. Keep all language-specific logic inside the adapter.

## Conventions

- ESM project (`"type": "module"`); use ESM imports.
- Vitest only — never import from `jest`.
- ESLint runs with `--max-warnings 0`; warnings fail CI.
- Conventional Commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:` (scopes encouraged, e.g. `fix(python-adapter): ...`).
- Follow TDD: write the failing test first, then implement.
