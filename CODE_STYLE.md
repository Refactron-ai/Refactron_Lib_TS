# Code Style

Concrete coding rules for this repository. These extend `CLAUDE.md` (project instructions) and `CONTRIBUTING.md` (workflow). When this document and CLAUDE.md disagree, CLAUDE.md wins — but they should not disagree; flag drift in a PR.

---

## TypeScript

### Imports

- ESM only. `import x from './y.js'` — yes, the `.js` extension even when the source is `.ts`. Required by Node ESM resolution.
- Never import from `jest`. Vitest is the only test runner.
- Group imports: node built-ins → third-party → first-party (`../`) → relative (`./`). One blank line between groups.
- Import types with `import type { … }` when the value isn't needed at runtime.

### Types

- `any` is a CR-block. If you genuinely need it, write `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- <one-line reason>` on the same line.
- Prefer `unknown` + narrowing over `any`.
- Discriminated unions for state machines (sessions, plans, verdicts).
- `satisfies` over `as` when shape matters: `const x = { … } satisfies SomeType;` keeps the literal narrow.
- Exhaustiveness on `switch`/`if` chains over union types:
  ```ts
  function f(x: 'a' | 'b'): number {
    switch (x) {
      case 'a': return 1;
      case 'b': return 2;
      default: { const _: never = x; throw new Error(`unreachable: ${x as string}`); }
    }
  }
  ```
- `Record<K, V>` over `{ [k: string]: V }` when `K` is a known union — the compiler enforces completeness.

### Functions

- Prefer `function` declarations for top-level exports; arrow functions for callbacks / one-off lambdas.
- Async: return `Promise<T>`, not `Promise<T | undefined>` when the success type isn't optional — throw, don't return undefined.
- No `Promise<any>`. Use `Promise<unknown>` and narrow at the caller.

### Errors

- Throw `Error` subclasses for distinct failure modes (e.g. `class ParseError extends Error`). Don't throw strings.
- Caller catches the narrowest type that makes sense. No bare `try { } catch (e) { /* swallow */ }`.

### Comments

- Default to **no comments**. Names should explain *what*.
- A comment is appropriate when it explains *why* the code is non-obvious: a workaround for a specific bug, a hidden invariant, a subtle compatibility constraint.
- Never explain *what* the code does. The code does that.
- Never reference issue numbers, PRs, or "added by X for Y" in comments — that's PR description territory and rots.

### File organization

- One default export per file, when an export needs to dominate.
- Files > 400 LOC trigger decomposition review. Not a hard rule, a smell.
- Co-locate test fixtures with the test (inline strings beat `fixtures/` for unit tests).

---

## Python (sidecars)

### Imports

- Stdlib only, plus `libcst` (vendored). Adding a new dep requires an ADR.
- `from __future__ import annotations` always first (PEP 236). When inserting imports into user code, respect this order.

### LibCST

- Use `cst.CSTVisitor` for read-only traversal, `cst.CSTTransformer` for mutations.
- `m.findall` recurses into nested `FunctionDef`/`ClassDef` — use a visitor with `visit_FunctionDef → return False` when you want to stop at the boundary.
- Distinguish `cst.IndentedBlock` from `cst.SimpleStatementSuite` (inline `def f(): pass`). A type-check that only matches `IndentedBlock` silently skips inline forms.

### Sidecar contract

- Read `sys.argv[1]`, write through `_base.emit(ok, new_content, preconditions, error)`.
- **Every refusal path emits a precondition** with `{id, satisfied: False, reason}`. Silent refusals are bugs.
- On parse error: `emit(ok=False, error=str(e))`. Don't crash.
- Output `new_content=""` on no-op (signals "no change"). Never write the source back unchanged.

### Style

- PEP 8 with Black-style line length (88).
- Type-annotate the public surface of helpers (`def _foo(node) -> bool:`); leave the internal lambdas alone.
- Docstrings: triple-quote, present-tense, one summary line, then a blank line, then details if needed.

---

## Both languages

### Naming

- TypeScript: `camelCase` for vars/funcs, `PascalCase` for types/classes, `SCREAMING_SNAKE` for module-level constants.
- Python: `snake_case` for vars/funcs, `PascalCase` for classes, `SCREAMING_SNAKE` for constants.
- File names: TypeScript `kebab-case.ts`, Python `snake_case.py`.
- Test files: mirror the implementation path, suffix `.test.ts` / `_test.py`.

### Commits

See `COMMIT_CONVENTIONS.md`.

### Tests

See `.claude/agents/test-engineer.md`.

### Documentation

- `docs/` (mdx) is user-facing: tone is "what it does" + "how to use."
- `dev-docs/` (md) is internal: tone is "why we built it this way" + "what's coming."
- `CHANGELOG.md` is user-facing — every entry should be intelligible to a user who's never read the source.

---

## Bypassing rules

These rules exist to prevent specific failure modes. If a rule is wrong for a case, the right path is:

1. State which rule and why it's wrong here.
2. Propose either a one-off carve-out (with a code comment justifying it) or an amendment to this document.
3. Get review.

Never silently bypass. The code reviewer is reading for this.
