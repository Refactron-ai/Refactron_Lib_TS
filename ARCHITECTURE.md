# Architecture

The big picture for contributors. Pairs with `CLAUDE.md` (concise rules),
`CONTRIBUTING.md` (workflow), and `dev-docs/decisions/` (specific ADRs).

This describes the tree as of 0.4.0, after the refactoring product was split
out. The transforms, the analyzers, the autofix engine, the adapters and the
Ink TUI are not here; they are archived with their history.

---

## What Refactron is

A verification layer for code change. Given a project root and a unified diff,
it answers one question with one of three words:

| Verdict    | Meaning                                                              |
| ---------- | -------------------------------------------------------------------- |
| `SAFE`     | The gates passed and the tests executed the lines that changed.      |
| `UNSAFE`   | A gate failed. The change breaks something.                          |
| `UNPROVEN` | The gates passed, but nothing established that the change is tested. |

`UNPROVEN` is the reason the product exists. A tool that only says pass or fail
has to lie when it cannot tell, and the lie is always in the same direction.

**A false `SAFE` is the only unforgivable defect.** Every other bug is a bug;
that one removes the reason to run the tool. Two have shipped, both fixed in
0.3.1, and both had the same cause: coverage measured a different program than
the tests gate ran.

No LLM anywhere. The verdict is deterministic and reproducible.

---

## Two entry points, one engine

```
  refactron verify-diff              refactron-mcp  (stdio)
  src/cli/verify-diff-command.ts     src/mcp/tools/verify-change.ts
                    \                /
                     verifyDiff()                src/verify/verify-diff.ts
                          │
                 ┌────────┴────────┐
            diff intake       shadow tree
                          │
        gate 1 syntax → gate 2 imports → gate 3 tests
                          │
              changed-line coverage attribution
                          │
                   verdict fusion                 src/verify/verdict-fuse.ts
                          │
                    VerdictReport
```

Both surfaces call the same function and serialize the same `VerdictReport`.
There is no separate "MCP mode": if the CLI and the MCP tool ever disagree
about a diff, that is a bug.

---

## Pipeline

1. **Intake** (`verify/diff-input.ts`). Parse and validate the diff. Reject what
   cannot be applied faithfully rather than applying an approximation. A
   rejection is a result, not a crash.
2. **Shadow tree** (`verify/shadow-tree.ts`). Copy the project to an isolated
   location and apply the diff **there**.
3. **Gate 1, syntax** (`verify/gates/syntax.ts`). Per-language checks under
   `verify/checks/`. Python goes through a sidecar in `checks/_py/`; TypeScript
   uses the compiler API.
4. **Gate 2, imports** (`verify/gates/imports.ts`). Does every import in the
   changed files still resolve.
5. **Gate 3, tests** (`verify/gates/tests.ts`). Run the project's real test suite
   against the shadow tree, using the runner detected in `verify/runners/`.
6. **Attribution** (`verify/statement-map.ts`, `verify/coverage-attribution.ts`).
   Map changed lines to enclosing statements, then ask whether the run executed
   them. Attribution is by AST statement containment, not line number, because
   `coverage.py` reports a multi-line statement at its first line.
7. **Fusion** (`verify/verdict-fuse.ts`). A pure function from gate results plus
   coverage to a verdict. No I/O, so the decision is testable in isolation.

---

## Four load-bearing invariants

### 1. Shadow-tree isolation

Verification runs against a copy. Nothing in this repo writes to the caller's
tree, in any path, for any verdict. This is what makes it safe to point at a
diff you do not trust, which is the whole use case.

### 2. Honest degradation

When something cannot be measured the verdict degrades toward `UNPROVEN`, never
toward `SAFE`. Coverage attestation is `coverage.py` only, so a non-Python or
mixed diff returns `UNPROVEN` rather than a guess. `verdict-fuse.ts` types the
coverage tool as `'coverage.py' | 'none'` so there is no third state that could
be mistaken for evidence.

### 3. The shadow-bypass guard

If a changed file is absent from `measuredFiles`, the suite never loaded the
copy being verified: it exercised the installed package, or a different path
entirely. The verdict is floored at `UNPROVEN` with a reason naming the remedy.
Without this, an editable install produces a confident `SAFE` for code that no
test touched.

### 4. Measurement parity

The coverage run must be **observationally equivalent** to what the tests gate
ran. `toCoverageRunArgs` in `src/analyze/coverage/python-line-coverage.ts`
returns non-null only when it can reproduce the gate's argv and environment
exactly, and declines otherwise. A decline costs a `SAFE` verdict; a wrong
reproduction costs the product's credibility. Read the rule block at the top of
that file before changing it — both shipped false `SAFE`s originated there.

---

## Locked surface

`src/contracts.ts` is the locked engine surface: the engine interfaces,
`RefactorPlan`, `FileChange`, `GateResult` and the `TransformId` union.

A locked surface change requires:

1. An ADR in `dev-docs/decisions/`
2. A major version bump
3. A documented migration path for consumers

`VerdictReport` (`verify/verdict-fuse.ts`) is not in `contracts.ts` but is
equally public: the MCP tool and `verify-diff --json` serialize it verbatim, and
it carries `reportVersion` so consumers storing reports know which shape they
hold. Additive fields are safe; renames, removals and retypes are breaking.

`TransformId` still lists 20 transform literals with no transforms behind them.
Narrowing a locked contract in the same release that restructures the repo would
make any regression un-bisectable, so it waits for a later major.
`verify/verify-diff.ts` casts a synthetic `'external-diff'` id in the meantime.

---

## Extension points

- **A new language check**: add `verify/checks/<gate>-<language>.ts` and wire it
  into the gate. Language-specific logic stays in the check; the gates and the
  engine stay language-agnostic.
- **A new Python sidecar**: add `verify/checks/_py/<name>.py` and extend the
  `build:verify-sidecars` assertion, so a missing copy fails the build rather
  than failing every verdict at runtime.

---

## What is deliberately not here

- **No model in any path.** The verdict is deterministic and reproducible.
- **No network calls** from the verification engine; it runs entirely local.
- **No writes** to the caller's tree.
- **No coverage for languages other than Python.** The honest answer to "this
  cannot be measured" is `UNPROVEN`, not an estimate.

---

## Related reading

- `CLAUDE.md`: working rules and ops scaffolding
- `GLOSSARY.md`: shadow tree, gate, verdict, attribution
- `RUNBOOK.md`: release, rollback, CVE response
- `docs/verification/`: the user-facing explanation of the same material
