# Contributing to Refactron

Thank you for your interest in contributing. This document covers everything you need to get started.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Project Structure](#project-structure)
- [Locked Contracts](#locked-contracts)
- [Writing Tests](#writing-tests)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Issue Guidelines](#issue-guidelines)
- [Commit Style](#commit-style)

---

## Code of Conduct

Be respectful. We do not tolerate harassment, discrimination, or dismissive behavior of any kind. Constructive criticism is welcome; personal attacks are not.

---

## Getting Started

```bash
git clone https://github.com/Refactron-ai/Refactron_Lib_TS.git
cd Refactron_Lib_TS
npm install
npm test          # all 45 tests must pass before you start
npm run build     # verify the build
```

Requirements: Node.js 18+, Python 3.8+ (for Python adapter tests).

---

## Development Workflow

1. Fork the repo and create a branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```

2. Make your changes following the guidelines below.

3. Ensure all checks pass:
   ```bash
   npm run typecheck
   npm run lint
   npm run format:check
   npm test
   npm run build
   ```

4. Open a pull request against `main`.

---

## Project Structure

Key directories:

```
src/core/models.ts          ← LOCKED. Never modify.
src/adapters/interface.ts   ← LOCKED. Never modify.
src/analysis/               ← Analyzers and blast radius
src/verification/           ← Verification engine and checks
src/autofix/                ← AutoFix engine and fixers
src/adapters/               ← Language adapters
src/pipeline/               ← Session, store, queue
src/cli/                    ← CLI entry point and commands
src/ui/                     ← Ink terminal UI components
tests/                      ← Unit, integration, verification tests
```

---

## Locked Contracts

**`src/core/models.ts` and `src/adapters/interface.ts` are frozen.** Do not open PRs that modify these files. They define the contracts that every other module depends on.

If you believe a contract change is necessary, open an issue for discussion first — these changes require a major version bump and coordinated migration.

---

## Writing Tests

- All new code must have tests.
- Tests live in `tests/unit/`, `tests/integration/`, or `tests/verification/`.
- Use Vitest. Import from `vitest`, not from `jest`.
- Follow the existing TDD pattern: write the failing test first, then implement.

**Every `CodeIssue` produced by any analyzer must have a non-null `blastRadius`.** Tests that produce issues without blast radius will be rejected.

```typescript
// Good — blastRadius always present
const issue: CodeIssue = {
  ...fields,
  blastRadius: { affectedFiles: [], affectedFunctions: [], affectedTestFiles: [], score: 0, level: 'trivial' },
};
```

---

## Adding a New Analyzer

1. Create `src/analysis/analyzers/your-analyzer.ts` extending `BaseAnalyzer`.
2. Add it to `src/analysis/engine.ts`.
3. Add a config key to `RefactronConfig` in `src/core/config.ts` and `refactron.yaml`.
4. Write tests in `tests/unit/analyzers.test.ts`.

## Adding a New Fixer

1. Create `src/autofix/fixers/your-fixer.ts` extending `BaseFixer`.
2. Declare `supportedIssueTypes` matching the issue `type` strings it handles.
3. Register it in `src/autofix/engine.ts`.
4. Write tests in `tests/unit/autofix-engine.test.ts`.

## Adding a Language Adapter

1. Implement `ILanguageAdapter` from `src/adapters/interface.ts`.
2. Register it in `src/adapters/registry.ts`.
3. All language-specific logic must stay inside the adapter — the verification engine must remain language-agnostic.
4. Write tests in `tests/unit/your-adapter.test.ts`.

---

## Submitting a Pull Request

- Keep PRs focused. One feature or fix per PR.
- Reference the issue number in the PR description.
- Include a short description of what changed and why.
- All CI checks must pass before review.
- PRs that modify `src/core/models.ts` or `src/adapters/interface.ts` will be closed without review.

**PR template:**

```
## What
Brief description of the change.

## Why
The problem this solves or the motivation.

## How
Key implementation decisions.

## Tests
What tests cover this change.
```

---

## Issue Guidelines

- **Bug reports** — include OS, Node version, Python version, the command you ran, and the full error output.
- **Feature requests** — describe the use case first, not just the implementation. Explain what problem it solves.
- **Security issues** — do **not** open a public issue. Email security@refactron.dev instead.

---

## Commit Style

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add support for Go language adapter
fix: handle empty file list in blast radius analyzer
test: add edge case for circular import detection
docs: update README quick start section
chore: bump vitest to 2.0
refactor: simplify verification engine check selection
```

Scope is optional but helpful: `feat(blast-radius): ...`, `fix(python-adapter): ...`
