# Refactron — Product Requirements (v2.0, Frozen)

## Definition

Refactron finds legacy code and technical debt in production codebases, refactors it to modern solutions, and proves nothing broke before touching a single file.

## Target User

A solo developer working in Python or TypeScript, maintaining a legacy codebase between 10k and 500k lines, who refuses to use LLM-based coding tools. The constraint is non-negotiable: code-altering decisions must be deterministic, reproducible, and verifiable. Output must be a diff that can be reviewed, not a suggestion that must be trusted.

## The Four-Step Pipeline

The pipeline is strictly sequential. Steps 1 through 3 contain zero LLM calls. Only Step 4 may invoke an LLM, and only on artifacts already proven correct.

### Step 1 — Deep Analysis

Scans the full dependency graph of the target project. Detects legacy patterns, deprecated APIs, and technical debt at the AST level. Emits SQALE-style remediation cost per finding. Read-only: no file on disk is modified. No LLM is used.

### Step 2 — Refactoring Engine

Applies deterministic, rule-based AST transforms. Same input produces the same output, every time. Built on ts-morph for TypeScript and LibCST for Python. Each transform has documented preconditions; if a precondition fails, the transform is skipped, not approximated. No LLM is used.

### Step 3 — Verification Engine

Three gates run against a shadow copy of the candidate tree before any byte reaches the original repository. All three must pass. If any gate fails, the original files are never touched. Writes that pass go through an atomic temp-file-and-rename. No LLM is used.

### Step 4 — Documentation Engine

The only step permitted to call an LLM. Generates docstrings, inline comments, and changelog entries for refactors that have already cleared Step 3. The LLM never edits code, never decides on a transform, and never observes a file that has not been verified.

## The Ten Launch Transforms

Python:

- `callback_to_async_await` — converts trailing-callback functions into native async/await.
- `format_to_fstring` — rewrites `%` and `.format()` string formatting as f-strings.
- `manual_typecheck_to_hints` — replaces `isinstance` dispatch chains with `Union` type hints.
- `deprecated_api_requests_to_httpx` — migrates `requests` imports and call sites to `httpx`.
- `class_to_dataclass` — converts boilerplate `__init__` classes into `@dataclass` definitions.

TypeScript:

- `var_to_const_let` — replaces `var` with `const` or `let` based on mutability analysis.
- `promise_chains_to_async` — flattens `.then()` chains into `async`/`await`.
- `implicit_any` — annotates implicit-any parameters when call-site inference is unambiguous.
- `commonjs_to_esm` — rewrites `require`/`module.exports` to ESM `import`/`export`.
- `promise_constructor_to_async` — converts simple `new Promise` constructors into async functions.

## The Three-Gate Safety Contract

Every candidate refactor must pass three gates, in order, before a single byte is written to the user's tree:

1. **Syntax** — re-parse the transformed file; reject on any parser error.
2. **Imports** — resolve every import in the transformed file; reject on any unresolved or broken reference.
3. **Tests** — run the project's test suite against the shadow tree in a subprocess; reject on any new failure.

Only after all three gates pass does the file land on disk, and only via an atomic write (temp file then rename). On any failure at any stage, the original file is left untouched and the candidate is discarded. There is no partial write. There is no rollback because there is nothing to roll back.

## Non-Goals

Refactron is not a linter. Not a formatter. Not a prettifier. Not an AI assistant. It does not suggest. It does not flag. It refactors.

## Success Criterion (v2.0 Launch)

`npm install -g refactron && refactron run --apply` produces verified, behavior-preserving diffs across both fixture repos.
