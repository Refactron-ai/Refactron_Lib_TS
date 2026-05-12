# ADR 001 — TypeScript AST library: ts-morph over Babel + recast

## Status

Accepted, 2026-05 (Week 1, Day 6–7).

## Context

Refactron's TypeScript refactoring engine needs a library that exposes full
semantic type information (transforms like `implicit_any` require inference from
call sites) **and** preserves formatting so diffs are reviewable. Two realistic
candidates:

- **ts-morph** — a high-level wrapper around the TypeScript Compiler API,
  maintained by David Sherret.
- **Babel + recast** — Babel for parsing, recast for format-preserving emission.

Plan Part 4's tech-stack table calls out ts-morph; this memo records why.

## Decision

Use ts-morph for all TypeScript transforms.

## Why ts-morph

- Wraps the actual TypeScript Compiler API. `Project.getSourceFile()`,
  `getType()`, `findReferencesAsNodes()`, and the symbol/scope APIs return the
  same type information `tsc` uses, including inference and generics
  resolution. Babel's TypeScript plugin is a **parser**, not a type checker —
  it sees syntax, not semantics.
- `implicit_any` (Transform 8) requires call-site inference. With ts-morph
  this is a short traversal that asks the checker for inferred types. With
  Babel, the only path is to wire `tsc` in separately and reconcile node
  positions across two ASTs; that reconciliation is a known source of subtle
  bugs in cross-tool codemods.
- Format preservation: ts-morph mutates through the Compiler API and only
  rewrites touched ranges, preserving surrounding trivia. Babel emits a fresh
  AST and recast re-attaches original tokens by node identity; trivia on
  mutated subtrees (especially comments inside reordered statements) is a
  known papercut.
- Actively maintained by a single owner with a regular release cadence.
  Babel + recast is two libraries with different maintainers and different
  release rhythms.

## Why not Babel + recast

- Two libraries, two failure modes, no shared type system across them.
- Recast trivia loss is documented in the recast and jscodeshift issue
  trackers; jscodeshift codemods routinely work around it. Refactron's
  reviewable-diff contract cannot tolerate that noise.
- Babel's TypeScript plugin parses TS but does not type-check; there is no
  equivalent of `getType()` without bolting on `tsc`.

## Consequences

- All TypeScript transforms (Transforms 6–10) target ts-morph.
- Test fixtures live under `fixtures/ts-legacy-mini/` and exercise ts-morph's
  mutation surface.
- ts-morph becomes a direct dependency in Week 2; it is added to
  `package.json` then, not now.
- Future polyglot expansion (Go, Rust) will need a separate adapter strategy.
  ts-morph does not generalise beyond the TypeScript compiler. Recorded as a
  known limitation.

## References

- ts-morph.com
- github.com/dsherret/ts-morph
- recast issue tracker (trivia-loss reports on mutated subtrees)
- jscodeshift issue tracker (recast-related formatting issues)
