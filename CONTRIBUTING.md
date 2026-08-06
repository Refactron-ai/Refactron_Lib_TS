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
git clone https://github.com/Refactron-ai/refactron.git
cd refactron
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

```
src/verify/                 ← the verification engine: shadow tree, gates, checks, fusion
src/verify/checks/_py/      ← Python sidecars (stdlib only), copied to dist/ at build
src/analyze/coverage/       ← coverage.py invocation and parsing
src/mcp/                    ← the stdio MCP server exposing verify_change
src/cli/                    ← the two-verb dispatcher and verify-diff command
src/auth/                   ← OAuth device flow and credential storage
src/index.ts                ← the library entry point
tests/                      ← unit and integration tests, plus fixtures
```

---

## Locked Contract

`src/contracts.ts` is the only locked file. Modifying it requires an ADR in
`dev-docs/decisions/`, a major version bump and a coordinated migration. If you
believe a change is necessary, open an issue for discussion first.

---

## Writing Tests

- All new code must have tests.
- Tests live in `tests/unit/` or `tests/integration/`.
- Use Vitest. Import from `vitest`, not from `jest`.
- Write the failing test first and prove it red before implementing. A
  regression test that was never red is not evidence.
- A test whose prerequisite may be missing uses `it.skipIf`, never an early
  return: an early return reports PASSED and proves nothing.
- Do not skip on repo state you control. `dist/` missing is a hard failure, not
  a skip; skipping on it is how six CLI assertions silently stopped running.

**Anything that can change a verdict needs its safety case pinned in both
directions.** It is not enough to show the good input produces `SAFE`; show that
the unmeasurable one produces `UNPROVEN` and the broken one produces `UNSAFE`.

---

## Adding a Language Check

1. Create `src/verify/checks/<gate>-<language>.ts`.
2. Wire it into the matching gate in `src/verify/gates/`.
3. Keep language-specific logic inside the check. The gates and the engine stay
   language-agnostic.
4. Write tests in `tests/unit/verify/`.

## Adding a Python Sidecar

1. Create `src/verify/checks/_py/<name>.py`. Stdlib only.
2. `scripts/postbuild.mjs` derives the list from that directory and asserts each
   file reaches `dist/`, so nothing further is needed to have it verified.
3. Remember the sidecar is copied, not compiled: a mistake there is silent at
   build time and fatal at runtime.

---

## Submitting a Pull Request

- Keep PRs focused. One feature or fix per PR.
- Reference the issue number in the PR description.
- Include a short description of what changed and why.
- All CI checks must pass before review.

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
feat: add a Go syntax check
fix: decline shebangs we cannot reproduce exactly
test: add edge case for circular import detection
docs: update README quick start section
chore: bump vitest to 2.0
refactor: simplify gate selection
```

Scope is optional but helpful: `fix(coverage): ...`, `feat(cli): ...`
