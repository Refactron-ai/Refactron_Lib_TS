# Refactron comparison bench

A reproducible head-to-head benchmark of Refactron against the deterministic
codemod field — **jscodeshift**, **Comby**, **ESLint `--fix`**, and **LibCST**
— on two refactoring transforms. This directory is the data artifact behind
research paper #02 (`dev-docs/Research-comparison-plan.md`).

Every number in `summary-<DATE>.md` is computed from `results-<DATE>.jsonl`,
which is one JSON record per measured run. Nothing is estimated. If a tool
cannot perform a transform, its cell is `N/A` with a one-line reason.

## What this measures

For each `(tool, transform)` cell, on byte-identical fixture trees:

1. **Speed** — wall-clock seconds for the tool invocation, including process
   startup. Median / min / max of 5 measured runs (+1 discarded warmup).
2. **Coverage** — of N planted formatting/declaration sites, how many did the
   tool rewrite *correctly* vs miss / get *wrong* / leave with *broken syntax*.
   Graded by `harness/checker.ts` (TS) and `harness/checker.py` (Python)
   against per-file `expected.json` sidecars.
3. **Safety** — does the rewritten tree still compile (`tsc --noEmit` /
   `py_compile`) and pass the fixture's sanity test suite (`vitest` / `pytest`)?

### Transforms

| Transform | Language | Tools that apply |
|---|---|---|
| `var-to-const-let` | TypeScript | Refactron, jscodeshift, Comby, ESLint |
| `format-to-fstring` | Python | Refactron, Comby, LibCST |

ESLint and jscodeshift are **N/A for `format-to-fstring`** (no Python support);
LibCST is **N/A for `var-to-const-let`** (Python-only library). Those N/A cells
are themselves a data point about each tool's polyglot reach.

## Fairness rules (frozen before any tool ran)

1. **Same input.** Every tool sees a byte-identical copy of the fixture tree,
   freshly copied to a `mktemp -d` per run.
2. **Equivalent codemod.** For each tool we author the codemod (or use the
   vendor's reference impl) with the same intent. All codemod sources live in
   `codemods/` for audit. None is hand-tuned to favor a particular tool.
3. **Cold start.** Each measured run starts from a fresh temp copy; wall-clock
   includes process startup. We measure "what a user waits for".
4. **Failure is data.** A tool that breaks a fixture gets a safety `FAIL` row,
   not a dropped data point. A tool that can't do a transform gets `N/A`.
5. **5 runs per cell**, report median + min + max — never single best.
6. **Hardware fixed** — Apple M2, recorded in the jsonl header.

## Directory layout

```
bench/comparison/
  fixtures/
    var-to-const-let/small/   10 .ts files + expected.json sidecars + vitest suite
    format-to-fstring/small/  10 .py files + expected.json sidecars + pytest suite
  codemods/
    jscodeshift/   var-to-const-let.js  + INVOKE.md
    comby/         *.toml templates     + INVOKE.md
    eslint/        eslint.config.mjs    + INVOKE.md
    libcst/        format-to-fstring.py + INVOKE.md   (wraps the reference command)
    refactron/     INVOKE.md            (transforms ship in the CLI itself)
  harness/
    run.sh         orchestrator: warmup + 5 runs per cell -> results-<DATE>.jsonl
    checker.ts     coverage grader for var-to-const-let (ts-morph)
    checker.py     coverage grader for format-to-fstring (libcst)
    safety.sh      compile + test gate per language
    summarize.py   results-<DATE>.jsonl -> summary-<DATE>.md
  results-<DATE>.jsonl   raw measured runs (one JSON per line)
  summary-<DATE>.md      computed aggregate table
```

## Reproducer

One-liner (assumes tools installed — see below):

```
bash bench/comparison/harness/run.sh
```

Then recompute the summary:

```
python3 bench/comparison/harness/summarize.py \
    bench/comparison/results-$(date +%Y-%m-%d).jsonl \
    > bench/comparison/summary-$(date +%Y-%m-%d).md
```

Override the matrix with env vars:

```
TOOLS=refactron,eslint TRANSFORMS=var-to-const-let ITERATIONS=3 \
    bash bench/comparison/harness/run.sh
```

## Tool installation

Refactron itself must be built first (`npm run build` at the repo root); the
harness invokes `dist/cli/index.js`.

| Tool | Check | Install if missing |
|---|---|---|
| Comby | `which comby` | `brew install comby` |
| jscodeshift | — | `cd codemods/jscodeshift && npm install --no-save jscodeshift` |
| ESLint | — | `cd codemods/eslint && npm install --no-save eslint @typescript-eslint/parser` |
| LibCST | `python3 -c "import libcst"` | `python3 -m pip install libcst` (or a venv) |
| pytest | `which pytest` | `python3 -m pip install pytest` |

The TS fixture also needs `typescript` + `vitest` installed inside
`fixtures/var-to-const-let/small/` (`npm install --no-save typescript vitest`)
for the safety gate.

jscodeshift and ESLint are installed **locally inside `codemods/<tool>/`** —
they never pollute the global environment. The harness invokes them via the
`node_modules/.bin/` binary in those directories.

## Honest limitations — what this bench does NOT measure

- **Cross-file refactors.** Every transform here is single-file. Refactron's
  blast-radius / import-graph machinery is not exercised.
- **Medium / large fixtures.** Only the `small` size (10 files) ships so far.
  Speed rankings can shift at scale (startup cost amortizes).
- **Parallelism.** Tools run single-threaded, one invocation per run. Some
  tools parallelize internally; we do not tune that.
- **IDE / interactive refactoring.** IntelliJ SSR, VS Code Quick Fixes, Cursor,
  Copilot are out of scope — they are interactive or stochastic, not batch.
- **Codemod breadth.** We benchmark two transforms. LibCST ships a much larger
  command library; Comby is far more flexible on ad-hoc patterns. A two-cell
  result is not a verdict on a tool's whole surface.
- **The competing codemods are honest but not infinitely polished.** The
  jscodeshift `var-to-const-let.js` is the conventional ~120-line recipe; it
  has a real reassignment-scan gap on loop counters that the safety gate
  catches. That gap is representative of hand-written codemods, and the source
  is in `codemods/` for reviewers to audit and improve.

## Reading the results

See `summary-<DATE>.md` for the computed table. Key columns:

- **Coverage %** = `correct / total_planted`. Deterministic across runs.
- **Wrong** = rewrote a site to the wrong target, or rewrote a site that
  should have been skipped.
- **Broken** = produced unparseable output at that site.
- **Safety** = `compile / tests`; `FAIL` means the tool's output did not
  compile or failed the sanity suite. The raw jsonl `failing_tests` field has
  specifics.

A tool can have high coverage and still fail safety — that is the central
point of the benchmark: a rewrite that is "mostly right" but breaks the build
is not a safe rewrite.
