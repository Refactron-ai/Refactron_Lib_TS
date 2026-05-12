# ADR 002 — Python CST library: LibCST over parso / RedBaron

## Status

Accepted, 2026-05 (Week 1, Day 6–7).

## Context

Python's built-in `ast` module is lossy — it discards comments, parentheses,
and whitespace, so any module re-emitted from `ast` will lose formatting.
Codemods need a concrete syntax tree (CST). Three candidates:

- **LibCST** — CST library maintained by Instagram (Meta).
- **parso** — the parser used by Jedi.
- **RedBaron** — an older CST built on baron.

## Decision

Use LibCST for all Python transforms.

## Why LibCST

- True CST: every token, comment, and whitespace run is preserved.
  Re-emitting an unmodified tree is byte-identical to the input.
- Ships ready-made codemods, including `ConvertFormatStringCommand`, which is
  Refactron's `format_to_fstring` transform (plan Part 3, Transform 2). The
  plan explicitly says to ship this as-is.
- Metadata system (`MetadataWrapper`, `ScopeProvider`, `ParentNodeProvider`)
  makes precondition checks tractable. Transform 5's "this class's `__init__`
  only assigns `self.x = x`" check is a tree predicate over named scopes, not
  a text scan.
- Maintained by Instagram/Meta and used in production for migrations on
  Instagram's Python codebase.
- Strong typing: every node class is a typed dataclass with typed fields,
  which catches transform bugs at type-check time.

## Why not parso

- parso is a parser, not a codemod framework. It produces a tree but offers
  no scope analysis, no metadata system, and no transformer base classes.
  Building those on top of parso is exactly the work LibCST already shipped.
- parso's tree is closer to a token stream than a typed AST; node access
  goes through `children[i]` index lookups, which makes transforms brittle
  to grammar revisions.

## Why not RedBaron

- Unmaintained. Last meaningful release predates Python 3.9. No support for
  walrus, `match`/`case`, or the newer type-parameter syntax. Disqualifying
  for a project that targets current Python.

## Consequences

- All Python transforms (Transforms 1–5) target LibCST.
- `ConvertFormatStringCommand` is shipped as-is for `format_to_fstring`; do
  not reimplement.
- LibCST is a Python-side dependency. The TypeScript adapter
  (`src/adapters/python/index.ts`) shells out to `python3` via `execa`, so
  libcst is imported inside the Python sidecar and does **not** appear in
  `package.json`. This matches the existing adapter strategy.
- Python adapter test fixtures live under `fixtures/python-legacy-mini/`.

## References

- github.com/Instagram/LibCST
- LibCST documentation: `ConvertFormatStringCommand`
- github.com/davidhalter/parso
- github.com/PyCQA/redbaron (note last-release date)
