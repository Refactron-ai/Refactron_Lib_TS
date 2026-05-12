# tests/e2e — Golden End-to-End Tests

This directory holds the binary success target for Refactron v2.0.

## `golden.test.ts`

The single e2e test that defines what "Refactron works" means. It copies
`fixtures/python-legacy-mini` to a temp directory, runs
`refactron run --apply --transforms=all <scratch>`, and then asserts four
gates on the result:

1. **CLI gate** — the subcommand exits 0.
2. **Test gate** — `pytest -q` still passes on the refactored tree.
3. **Syntax gate** — every non-test `.py` file still parses via `ast.parse`.
4. **Import gate** — every top-level fixture module still imports cleanly.
5. **Deterministic-diff snapshot** — the unified diff of all `.py` files
   matches a Vitest snapshot (created on first green run).

This is the test that Week 4 must turn green. It is intentionally red
today.

## How to run

```bash
npm run build       # required: the test invokes dist/cli/index.js
npm run test:e2e
```

The test is excluded from `npm test` because (a) it requires Python 3.8+
with `pytest` installed and (b) it is intentionally red until the Week 4
refactoring engine and `run --apply` subcommand land.

## Current expected failure mode

The CLI in `src/cli/index.ts` has no `run` subcommand registered — only
`analyze`, `autofix`, `verify`, `rollback`, `status`, `diff`. Today the
invocation falls through to the interactive REPL/auth flow, which exits
non-zero in a non-TTY subprocess with:

```
Warning: Detected unsettled top-level await at file:///.../dist/cli/index.js:44
await run(process.argv.slice(2));
```

The CLI gate assertion fails with `expected 13 to be 0`. That is the
"right reason" failure — proof that the `refactron run --apply` shape
does not yet exist. Any other failure (TypeScript error, missing
dependency, snapshot mismatch on a fresh run) is the wrong reason and
must be fixed in the test itself.

## Adding new e2e cases

Add a new fixture under `fixtures/<name>/` with a passing test suite,
then add a sibling `tests/e2e/<name>.test.ts` that follows the same
shape: copy fixture to a temp dir, snapshot before, invoke the CLI,
re-run the project's test command, and snapshot the diff. Keep each
e2e test self-contained — no shared module state, no shared fixtures.
