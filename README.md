# Refactron

> **Alpha — do not use in production.**
> Refactron is mid-rebuild on the v2.0 architecture. The npm package on the registry is the older blast-radius engine; the `main` branch is the in-flight v2.0 surface. The golden end-to-end test is intentionally red until the Week 4 refactoring engine lands.

> Safety-first refactoring — finds, fixes, and verifies code changes are safe before touching the filesystem.

[![CI](https://github.com/Refactron-ai/Refactron_Lib_TS/actions/workflows/ci.yml/badge.svg)](https://github.com/Refactron-ai/Refactron_Lib_TS/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/refactron)](https://www.npmjs.com/package/refactron)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)

---

## What is Refactron?

Refactron is a TypeScript CLI that analyzes your codebase for issues, automatically fixes what it can, and **verifies every change is safe before writing a single byte to disk**.

The core differentiator: **Blast Radius**. Every issue carries a mandatory impact score (0–100) computed from transitive import and call graphs. The verification engine scales its strictness based on this score — a one-liner fix in an isolated utility gets a quick syntax check, while a change to a widely-imported core module triggers syntax + import + full test suite verification.

```
refactron analyze src/
refactron autofix . --verify
```

---

## Features

- **Blast Radius Scoring** — every issue gets a 0–100 impact score across 5 levels (trivial → critical), computed from transitive import and call graphs
- **Verification Gate** — changes are verified (syntax, imports, tests) before being written; strictness scales with blast radius
- **Atomic Writes** — all file writes use temp-file-then-rename; partial writes never happen
- **Backup & Rollback** — every session is backed up; `refactron rollback` restores the previous state
- **14 Auto-fixers** — unused imports, trailing whitespace, dead code, missing type hints, sort imports, and more
- **7 Analyzers** — security (SQL injection, eval, hardcoded secrets), complexity, code smell, dead code, type hints, dependencies, performance
- **Python + TypeScript** — language-agnostic engine with pluggable `ILanguageAdapter`
- **Ink Terminal UI** — interactive issue browser with blast radius graph, diff view, and verification progress

---

## Installation

```bash
npm install -g refactron
```

Requires Node.js 18+ and (for Python analysis) Python 3.8+.

---

## Quick Start

```bash
# Analyze your project
refactron analyze src/

# Preview fixes without writing anything
refactron autofix . --dry-run

# Fix with full verification gate
refactron autofix . --verify

# Check session status
refactron status

# Undo last applied fixes
refactron rollback
```

---

## Commands

| Command | Description |
|---|---|
| `analyze [target]` | Scan files and report issues with blast radius scores |
| `autofix [target]` | Fix issues with verification before writing |
| `verify [file]` | Verify a specific file is safe to modify |
| `status` | Show current session state and fix counts |
| `rollback` | Restore files from last session backup |
| `diff [target]` | Display unified diff for a pending fix |

### Options

| Flag | Description |
|---|---|
| `--fail-on <level>` | Exit non-zero if issues at `critical`, `high`, `medium`, or `low` found |
| `--dry-run` | Preview fixes without writing to disk |
| `--verify` | Require verification gate before applying any fix |
| `--format <fmt>` | Output format: `terminal` (default), `json`, `sarif` |

---

## How Blast Radius Works

Every `CodeIssue` carries a mandatory `BlastRadius` object:

```typescript
interface BlastRadius {
  affectedFiles: string[];       // files transitively depending on the changed file
  affectedFunctions: string[];   // functions in the call chain
  affectedTestFiles: string[];   // test files that cover affected code
  score: number;                 // 0–100 weighted impact score
  level: BlastLevel;             // trivial | low | medium | high | critical
}
```

**Score formula:** `files (40%) + functions (40%) + test coverage gap (20%)`

**Verification escalation by blast level:**

| Level | Score | Checks Run |
|---|---|---|
| trivial | 0 | syntax only |
| low | 1–19 | syntax + imports + tests (45s timeout) |
| medium | 20–49 | syntax + imports + tests (45s timeout) |
| high | 50–74 | syntax + imports + tests (45s timeout) |
| critical | 75–100 | syntax + imports + tests (120s timeout) |

---

## Analyzers

| Analyzer | Issues Detected |
|---|---|
| Security | SQL injection, `eval()`, hardcoded secrets, `exec()` |
| Complexity | Cyclomatic complexity above threshold (default: 10) |
| Code Smell | Long methods, god objects |
| Dead Code | Unreachable code after `return`/`raise`/`break` |
| Type Hints | Missing return type annotations, explicit `any` |
| Dependencies | Unused imports |
| Performance | List concatenation in loops, `await` inside loops |

---

## Auto-fixers

| Fixer | What it fixes |
|---|---|
| `unused-imports` | Removes unused import statements |
| `trailing-whitespace` | Strips trailing whitespace from all lines |
| `dead-code` | Removes unreachable code |
| `sort-imports` | Sorts imports alphabetically |
| `normalize-quotes` | Normalizes quote style |
| `type-hints` | Adds `-> None` return type annotations |
| `docstrings` | Inserts placeholder docstrings |
| `simplify-boolean` | Simplifies `x == True` → `x` |
| `unused-variables` | Removes unused variable declarations |
| `fix-indentation` | Converts tabs to 4-space indentation |
| `missing-commas` | Adds missing trailing commas |
| `remove-debug` | Removes debug/print statements |
| `magic-numbers` | Flags magic numbers for manual review |
| `convert-fstring` | Flags `%`-format strings for manual conversion |

---

## Architecture

```
src/
├── core/
│   ├── models.ts          # All types — LOCKED (CodeIssue, BlastRadius, etc.)
│   ├── config.ts          # RefactronConfig + YAML loader
│   └── orchestrator.ts    # Full pipeline coordinator
├── adapters/
│   ├── interface.ts       # ILanguageAdapter — LOCKED
│   ├── registry.ts        # Language auto-detection
│   ├── python/            # Python adapter (subprocess)
│   └── typescript/        # TypeScript adapter (compiler API)
├── analysis/
│   ├── blast-radius.ts    # Transitive impact scoring
│   ├── import-graph.ts    # File-level reverse import graph
│   ├── call-graph.ts      # Function-level call graph
│   ├── temporal.ts        # Git history intelligence
│   ├── engine.ts          # Analysis orchestrator
│   └── analyzers/         # 7 language-agnostic analyzers
├── verification/
│   ├── engine.ts          # Blast-radius-aware check selection
│   ├── atomic-writer.ts   # Temp → rename safe writes
│   └── checks/            # syntax, imports, test-gate
├── autofix/
│   ├── engine.ts          # AutoFix orchestrator
│   └── fixers/            # 14 fixers
├── pipeline/
│   ├── session.ts         # State machine
│   ├── store.ts           # .refactron/ persistence
│   └── queue.ts           # Fix queue management
├── infrastructure/
│   ├── backup.ts          # Pre-write backup + rollback
│   ├── diff.ts            # Unified diff generation
│   └── git.ts             # Git log + co-change analysis
├── cli/
│   ├── index.ts           # Fast-path dispatcher (<10ms for --version)
│   ├── app.tsx            # Command router
│   └── commands/          # 6 Ink command components
└── ui/                    # Ink terminal UI components
```

---

## Configuration

Create a `refactron.yaml` in your project root:

```yaml
version: 2
analyzers:
  complexity:
    enabled: true
    threshold: 10        # cyclomatic complexity limit
  security:
    enabled: true
  code_smell:
    enabled: true
    max_method_lines: 50
  dead_code:
    enabled: true
  type_hints:
    enabled: true
  dependencies:
    enabled: true
  performance:
    enabled: true
verification:
  timeout_seconds: 45
  critical_timeout_seconds: 120
autofix:
  dry_run: false
  require_verification: true
output:
  format: terminal         # terminal | json | sarif
  fail_on: null            # critical | high | medium | low | null
```

---

## Development

```bash
git clone https://github.com/Refactron-ai/Refactron_Lib_TS.git
cd Refactron_Lib_TS
npm install

npm run build          # compile TypeScript
npm test               # run 45 tests
npm run typecheck      # type check only
npm run lint           # ESLint
npm run format         # Prettier
npm run test:watch     # watch mode
```

### Adding a Language Adapter

Implement `ILanguageAdapter` from `src/adapters/interface.ts` and register it in `src/adapters/registry.ts`. The interface is locked — all language-specific logic must stay inside the adapter.

### Adding a Fixer

Extend `BaseFixer` from `src/autofix/fixers/base.ts`, declare `supportedIssueTypes`, implement `fix()`, and register it in `src/autofix/engine.ts`.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

---

## License

MIT — see [LICENSE](./LICENSE).
