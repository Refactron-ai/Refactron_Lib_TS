# Architecture

The big picture for contributors. Pairs with `CLAUDE.md` (concise rules), `CONTRIBUTING.md` (workflow), and `dev-docs/decisions/` (specific ADRs).

---

## What Refactron is

A deterministic refactoring engine for TypeScript and Python codebases. Given a project root, Refactron:

1. **Analyzes** the source — runs detectors that report findings tied to specific transforms.
2. **Plans** a refactor — invokes transforms (TypeScript via ts-morph, Python via LibCST sidecars) to produce a list of file changes.
3. **Verifies** the plan — three gates: syntax check → import resolution → tests pass, all scaled by blast-radius level.
4. **Applies** the plan atomically — all-or-nothing batch write through `atomic-writer.ts`; failures roll back cleanly.
5. **Documents** the result — generates docstrings and CHANGELOG entries.

No LLM in the core path. Every transform is deterministic; the LLM is only invoked for documentation generation (`src/document/`), and even then is gated behind the same atomic-write boundary.

---

## The two-engine boundary

Refactron is mid-migration from a legacy engine surface to a v2.0 surface:

- **Legacy** (`src/core/models.ts`, `src/adapters/interface.ts`): pre-v2.0 types. **LOCKED.** Backed the blast-radius analysis engines and continues to compile.
- **v2.0** (`src/contracts.ts`): the four engine interfaces — `Analyzer`, `Refactorer`, `Verifier`, `Documenter` — plus `RefactorPlan`, `FileChange`, the `TransformId` literal union. **LOCKED.**

**Rule:** a single file imports from one side or the other, never both. Pick a side per module during the migration window.

A locked surface change requires:
1. An ADR in `dev-docs/decisions/`
2. A major version bump
3. A documented migration path for consumers

---

## Pipeline (high level)

```
   ┌────────────────┐
   │  refactron.yaml│ ← user config
   └───────┬────────┘
           ↓
   ┌────────────────┐  ┌─────────────────────────────────┐
   │  source files  │→ │  Adapter Registry              │
   └────────────────┘  │  (src/adapters/{python,ts})    │
                       └────────────┬────────────────────┘
                                    ↓
                       ┌────────────────────────────────┐
                       │  Analyzer  (src/analyze/)      │
                       │  • Detectors per transform     │
                       │  • Blast radius scoring        │
                       │  • Tier classification         │
                       └────────────┬────────────────────┘
                                    ↓ AnalysisReport
                       ┌────────────────────────────────┐
                       │  Refactorer (src/transform/)   │
                       │  • TRANSFORM_ORDER             │
                       │  • Composition per file        │
                       │  • Precondition emission       │
                       └────────────┬────────────────────┘
                                    ↓ RefactorPlan
                       ┌────────────────────────────────┐
                       │  Verifier (src/verify/, also   │
                       │  legacy src/verification/)     │
                       │  • Gate 1: syntax             │
                       │  • Gate 2: imports             │
                       │  • Gate 3: tests               │
                       │  Scope scales by blast-radius  │
                       └────────────┬────────────────────┘
                                    ↓
                       ┌────────────────────────────────┐
                       │  Atomic batch writer           │
                       │  (src/infrastructure/)         │
                       │  temp file → fsync → rename    │
                       │  rollback on partial failure   │
                       └────────────┬────────────────────┘
                                    ↓
                       ┌────────────────────────────────┐
                       │  Documenter (src/document/)    │
                       │  • Docstring insertion         │
                       │  • CHANGELOG update            │
                       └────────────────────────────────┘
```

State at every step is persisted to `.refactron/` (session, store, queue). Crashes or interrupts can resume from the last good state.

---

## Three load-bearing invariants

The rest of the system relies on these. Breaking any of them is a major-version event.

### 1. Atomic writes

Every file write goes through `src/infrastructure/atomic-writer.ts`:

```
write temp file → fsync → rename(temp, dest)
```

Partial writes are impossible. POSIX rename is atomic; on Windows, the `write-file-atomic` dep handles the equivalent. Mode bits are preserved.

**Why:** a refactor that fails mid-batch can never leave files in a half-written state. The user's working tree is always coherent.

### 2. Blast radius

Every `CodeIssue` carries a non-null `blastRadius` of shape:

```typescript
{
  affectedFiles: string[],
  affectedFunctions: string[],
  affectedTestFiles: string[],
  score: number,
  level: 'trivial' | 'low' | 'medium' | 'high' | 'critical',
}
```

Score formula: `files (40%) + functions (40%) + test-coverage gap (20%)`.

Verification scales by `level`:
- `trivial` → syntax only
- `low` / `medium` / `high` → syntax + imports + tests (45s timeout)
- `critical` → syntax + imports + tests (120s timeout)

**Why:** scaling verification depth to the change's reach prevents the syntax-only quick check from missing a critical regression, and prevents the full-tests gate from being wasted on a one-character whitespace edit.

### 3. Locked adapter interface

`ILanguageAdapter` (in `src/adapters/interface.ts`) is the only boundary the analysis and verification engines see. **All language-specific logic stays inside an adapter.** Python uses a `child_process.spawn` of `python3` against vendored sidecars. TypeScript uses `ts-morph` directly.

**Why:** the verification and analysis engines remain language-agnostic. Adding Go or Rust later is "implement `ILanguageAdapter`," not "fork the engine."

---

## Tier taxonomy

Every transform is classified at the v2-adapter layer (`src/cli/v2-adapters.ts`):

- **`debt`** — real maintenance burden with a forward-looking argument (deprecation timer, known bug class, Py2/Vue2 holdover). Worth a dedicated PR.
- **`modernization`** — newer-form-is-clearly-better, old form still works. Worth doing opportunistically.
- **`style`** — semantically identical, pure preference. Worth doing only on files you're already touching.

The `analyze` output groups findings by tier so users can read "57 debt items, 102 modernization, 2,569 style" instead of one undifferentiated count.

---

## Extension points

| You want to add… | Read |
|---|---|
| A new analyzer (detector) | `CONTRIBUTING.md` → "Adding a New Analyzer" |
| A new fixer (autofix) | `CONTRIBUTING.md` → "Adding a New Fixer" |
| A new transform end-to-end | `.claude/commands/new-transform.md` |
| A new language adapter | `CONTRIBUTING.md` → "Adding a Language Adapter" |
| A new verification check | `dev-docs/decisions/04-verify-engine-architecture.md` |

---

## What is NOT in this architecture

- **No LLM in the planning path.** Documentation is the only LLM consumer, and it operates on already-verified, already-written code.
- **No network calls from sidecars or core.** Sidecars are stdlib-only Python; the TypeScript core is stdlib + vendored deps. A network call would be a security review event.
- **No mutation of `playground/`.** The playground (Ansible checkout, etc.) is a trial corpus, not a release surface. Mutations to it from CI or local runs are bugs.

---

## Related reading

- `dev-docs/decisions/01-ts-morph-vs-babel.md` — why ts-morph for the TS side
- `dev-docs/decisions/02-libcst-vs-parso.md` — why LibCST for Python
- `dev-docs/decisions/04-verify-engine-architecture.md` — the 3-gate design
- `dev-docs/decisions/06-refactor-engine-architecture.md` — the transform composition model
- `dev-docs/Refactron_Detailed_Execution_Plan.md` — the original build plan

When in doubt, the ADRs are the source of truth — they explain not just what we built but what alternatives we rejected and why.
