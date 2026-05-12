# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
