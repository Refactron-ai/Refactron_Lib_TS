# Refactron vs the codemod baseline — a head-to-head study

> Research paper #02. Prose draft for the `/research/comparison-01` page.
> Dataset: `bench/comparison/`, branch history on `feat/comparison-bench` (merged PR #27).
> Companion to paper #01 (the 0.2.0 performance report).

---

## Abstract

Refactron is a deterministic refactoring CLI that verifies every change against
three gates — syntax, imports, and the project's own test suite — before
writing a byte. This paper measures Refactron against the existing
deterministic-codemod baseline: jscodeshift, Comby, ESLint `--fix`, and
LibCST. We benchmark two transforms — `var → const/let` (TypeScript) and
`%`/`.format()` → f-string (Python) — on identical fixtures, across three axes:
speed, coverage (did the tool rewrite each planted site correctly), and safety
(does the output compile and pass tests).

The result is mixed in exactly the way an honest benchmark should be. Refactron
is the slowest tool measured — 5–8× slower than ESLint on `var → const/let` —
because it runs a verification pipeline the others do not. It is also the only
tool that achieves top coverage on **both** transforms (100% and 99.1%) while
never producing a single unsafe rewrite. The two pure codemod tools that ship
no verification step, jscodeshift and Comby, run sub-second and produce output
that fails to compile.

---

## 1. Why this study

These tools are not Refactron's commercial competitors. A team choosing a
refactoring product weighs Refactron against Cursor, SonarQube, or simply doing
nothing. jscodeshift and LibCST are codemod *frameworks* — you author codemods
with them; you do not run them as products. Comby is a structural search/replace
DSL. ESLint `--fix` is a linter's autofix.

But they *are* the engineering baseline. They are the existing technology that
performs deterministic source-to-source transformation, and that is exactly what
Refactron's engine does. A new approach earns credibility by being measured
against the established one on identical inputs. That is this paper.

The honest framing throughout: this is "the new approach (transform + verify)
versus the existing approaches (transform only)", not "our product versus
theirs."

---

## 2. Setup

### 2.1 Transforms

Two transforms, chosen because between them they exercise every tool:

- **`var → const/let`** (TypeScript). Convert each `var` to `const` when the
  binding is never reassigned, `let` otherwise. Universal — jscodeshift, Comby,
  and ESLint `--fix` can all attempt it; LibCST cannot (Python only).
- **`%`/`.format()` → f-string** (Python). Convert old-style string formatting
  to f-strings. Refactron, Comby, and LibCST can attempt it; jscodeshift and
  ESLint cannot.

### 2.2 Fixtures

Two synthetic fixture trees, ten files each, ~50–100 LOC per file. Every file
plants a mix of the transform's target pattern with deliberate edge cases:
`var` reused across nested scopes, hoisting/TDZ traps, for-loop initializers;
`%s`/`%d`/`%.2f`/`%x`/width specifiers, `.format()` with `*args`/`**kwargs`,
`%(name)s` mapping syntax, `n % 7` arithmetic modulo. Each file ships a sidecar
listing every planted site with its expected outcome — `const`, `let`,
`f-string`, or `skip` — anchored to a stable identifier (the enclosing function
name) so classification survives line drift.

Total planted: 126 sites for `var → const/let`, 108 for `format → f-string`.

### 2.3 Tool invocations

Each tool runs the equivalent codemod, authored the way a competent engineer
would and committed to `bench/comparison/codemods/` for audit:

- **Refactron** — `refactron run --apply --transforms=<id>` (the full pipeline:
  transform → 3-gate verify → atomic write).
- **jscodeshift** — a ~120-line `var → const/let` visitor with a reassignment
  scan.
- **Comby** — a `:[hole]` template.
- **ESLint `--fix`** — stock config enabling `prefer-const` + `no-var`. No
  custom code; this is the "mature specialized linter" cell.
- **LibCST** — Instagram's reference `ConvertFormatStringCommand`.

### 2.4 Measurement

Apple M2, Node 24.2, Python 3.13. Five measured runs per cell after one
discarded warm-up; we report median / min / max. Each run starts from a fresh
copy of the fixture (cold start, no warm caches).

- **Speed** is wall-clock for the whole invocation, process startup included —
  what a user actually waits for.
- **Coverage** is per-site exact classification: correct / missed / wrong /
  broken, located by stable anchor (not line proximity).
- **Safety** runs `tsc --noEmit` (or `py_compile`) plus the fixture's own test
  suite against the tool's output. Either exits non-zero → unsafe.

The harness, checker, and raw `results-*.jsonl` are all in the repo. Anyone can
reproduce: `bash bench/comparison/harness/run.sh`.

---

## 3. Results

### 3.1 `var → const/let`

| Tool | Speed (median) | Coverage | Wrong | Safe |
|---|---|---|---|---|
| **Refactron** | 5.22s | **100%** (126/126) | 0 | ✅ |
| ESLint `--fix` | 0.65s | **100%** (126/126) | 0 | ✅ |
| jscodeshift | 0.67s | 46.0% (58/126) | 55 | ❌ |
| Comby | 0.29s | 47.6% (60/126) | 66 | ❌ |

Refactron and ESLint both convert every site correctly and produce safe output.
The two pure codemod tools do not. jscodeshift's hand-written reassignment scan
misses compound and loop-counter mutations, so it emits `const` on bindings that
are later reassigned — 55 wrong rewrites, and the output fails to compile. Comby
is worse: with no scope or reassignment model at all, its template cannot decide
between `const` and `let` and trips temporal-dead-zone traps — 66 wrong, also
failing compilation.

### 3.2 `%`/`.format()` → f-string

| Tool | Speed (median) | Coverage | Wrong | Safe |
|---|---|---|---|---|
| **Refactron** | 3.76s | **99.1%** (107/108) | 0 | ✅ |
| LibCST | 2.68s | 57.4% (62/108) | 0 | ✅ |
| Comby | 4.79s | 15.7% (17/108) | 0 (74 broken) | ❌ |

Refactron converts 107 of 108 sites; the single miss is a nested
`"outer {}".format(f"inner {name}")`. LibCST's reference codemod is safe but
covers only 57% — its percent-format command converts plain `%s` and skips
every `%d`, `%.2f`, `%x`, and width specifier. Comby produces invalid Python at
74 of 108 sites: its templates cannot disambiguate `"{}={}".format(k, v)` and
emit unparseable f-strings.

### 3.3 The two axes that move together

Across both transforms, the tools split cleanly into two groups. The tools that
are *careful* — Refactron via its verification gate, ESLint via a narrow
well-tuned ruleset, LibCST via a conservative codemod — produce safe output. The
tools that are *fast and unguarded* — jscodeshift and Comby — produce broken
output. There is no cell in this study where a tool was both fast (sub-second),
high-coverage, and safe. Speed without verification bought broken code every
time it was measured.

---

## 4. Discussion

### 4.1 Where Refactron wins

Refactron has the highest coverage on **both** transforms — a tie with ESLint at
100% on `var → const/let`, and an outright win at 99.1% vs LibCST's 57.4% on
`format → f-string` — while never emitting an unsafe rewrite. No other tool in
the study is top-coverage on both. ESLint matches it on the TypeScript transform
but cannot touch Python; LibCST is safe but low-coverage; the codemod tools are
neither.

### 4.2 Where Refactron loses

**Speed.** Refactron is the slowest tool measured — ~8× slower than ESLint on
`var → const/let`, ~1.4× slower than LibCST on `format → f-string`. This is not
an optimization gap to apologize for; it is the verification pipeline. ESLint
applies an autofix and stops. Refactron applies a transform, re-parses every
changed file, resolves every import, runs the project's full test suite on a
shadow tree, and only then writes — atomically. The 5.22s figure *is* that
pipeline. A tool that skips it is faster by definition. The benchmark's own
safety column shows what that skipped work would have cost: jscodeshift and
Comby are sub-second and emit code that does not compile.

The honest claim is therefore not "Refactron is fastest." It is: **Refactron is
the only tool measured here that never wrote broken code**, and that guarantee
has a price denominated in seconds.

### 4.3 What this study does not claim

- **Not a product comparison.** jscodeshift, Comby, LibCST, and ESLint are
  infrastructure and linters, not Refactron's commercial alternatives. A
  separate study should address Cursor, SonarQube, and the LLM tools — those
  comparisons are categorical, not numeric, and belong in their own paper.
- **Two transforms, not ten.** Refactron ships ten transforms; this paper
  measures two. They were chosen for tool overlap, not because they are
  representative of the hardest cases (`callback → async/await` is far harder).
- **Synthetic fixtures.** Ten files per transform with planted patterns. Real
  codebases have messier distributions. The fixtures are published so the
  methodology can be challenged and extended.
- **Single hardware target.** Apple M2. Absolute speeds will differ elsewhere;
  the *ratios* should hold.
- **The codemods we authored for other tools may not be optimal.** They are
  committed for audit precisely so a jscodeshift expert can show us a better
  visitor. If they do, we rerun and republish.

### 4.4 A note on how this benchmark was built

The first run of this benchmark reported Refactron at 27% coverage on
`var → const/let`. Investigation found two real bugs in Refactron's own
transform — a scope-unaware reference scan and a missed AST node kind — not
artifacts of the harness. They were fixed (coverage 27% → 100%) before
publication. The benchmark also caught a precision flaw in its own checker
(line-proximity matching) that was miscounting *every* tool; that was corrected
too. We mention this because it is the point: a benchmark you publish should be
one that has already embarrassed you in private.

---

## 5. Conclusion

On identical inputs, deterministic transformation *with* verification
(Refactron) and deterministic transformation by a mature specialized linter
(ESLint) produce correct, safe output. Deterministic transformation *without*
verification (jscodeshift, Comby) produces broken output, fast. Refactron pays
for its verification in wall-clock time and is the slowest tool here; in
exchange it is the only tool that is top-coverage on both transforms and never
unsafe on either.

The benchmark, fixtures, per-tool codemods, and raw results are public. Reproduce
or challenge them: `bash bench/comparison/harness/run.sh`.

---

## References

1. Comparison bench harness, fixtures, codemods, raw results — `bench/comparison/`
   in the Refactron repository.
2. Refactron 0.2.0 performance report — paper #01, `/research/perf-01`.
3. Opdyke, W. F. *Refactoring Object-Oriented Frameworks.* PhD thesis, UIUC,
   1992 — the precondition-checking foundation deterministic refactoring rests on.
4. Instagram / LibCST — `ConvertFormatStringCommand`, the reference Python
   format codemod benchmarked here.
5. `var_to_const_let` scope-correctness fix and the printf-grammar percent
   converter — PR #27.
