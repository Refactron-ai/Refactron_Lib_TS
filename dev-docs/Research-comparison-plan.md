# Comparison paper — methodology plan

> Working title: **"Refactron in context: a comparative study against LLM tools, static analyzers, and codemod frameworks"**
>
> Target ship: 3 working days from approval. Lives at `/research/comparison-01` on the website.
> Pairs with the existing perf report at `/research/perf-01`.
> Companion document to `dev-docs/Research` (the founder's strategic plan).

---

## Why this paper

The homepage `ComparisonSection` makes categorical claims against Cursor, SonarQube, and CodeAnt: yes/no on six capabilities. Those claims are correct positioning but currently rest on no published evidence — they could be challenged with "you can't say that without a study."

This paper provides the published evidence. It also extends the comparison to a category the homepage skips entirely: **the actual deterministic codemod competitors** (jscodeshift, Comby, ESLint `--fix`, LibCST built-in codemods). That's where Refactron should be benchmarked head-to-head with hard numbers, because they share the same engineering category.

The output: one substantial research artifact that defends every cell of the homepage table AND adds quantitative head-to-head data against the codemod field.

---

## Scope (what's in, what's out)

### In scope

**Part A — Categorical (vs marketing-adjacent tools).** Extend the homepage table. For each cell, attach either:
- A direct quote from the tool's own documentation, or
- A repro snippet showing the behavior, or
- A citation to a third-party study (NYU 40%, ACM 92.45%, UTSA 19.7%, etc. — see existing dev-docs/Research §1.4)

Tools covered: Refactron, Cursor, GitHub Copilot, SonarQube, CodeAnt, Greptile, Patched.

**Part B — Quantitative (vs codemod field).** Real benchmarks on shared inputs.

Tools covered: Refactron, jscodeshift, Comby, ESLint `--fix`, LibCST built-in codemod (the `ConvertFormatStringCommand` reference impl).

Transforms benchmarked:
1. **`var → const/let`** (TypeScript). Hits Refactron, jscodeshift, Comby, ESLint `--fix` cleanly. Universal target.
2. **`format → f-string`** (Python). Hits Refactron and LibCST's reference codemod. Tests Comby's polyglot story. ESLint and jscodeshift are N/A here, which itself is data.

Dimensions measured per (tool, transform, fixture):
- **Speed** — wall-clock for the entire run, including process startup. Median of 5.
- **Coverage** — of N planted instances, how many did the tool actually rewrite correctly?
- **Safety** — of the rewrites it produced, how many compile + pass the project's test suite without manual cleanup?

Fixture sizes:
- Small (10 files, ~200 LOC) — proves the methodology
- Medium (~50 files, ~5k LOC) — realistic per-file diversity

**Part C — Qualitative (where the table doesn't fit).**
- Cursor / Copilot: not in the numeric table because they're stochastic. Instead: a paragraph explaining why the comparison is categorical, citing the LLM-failure-rate literature (NYU 40%, ACM 92.45%, UTSA 19.7%).
- OpenRewrite: not in the numeric table because it's JVM + Gradle, runs on a different stack. Instead: a paragraph on what it does well (LST type-attribution) and why we share that philosophy.

**Part D — Honest limitations.** A discussion section listing what Refactron does NOT do better than the field. Examples likely:
- ESLint will be faster on trivial single-file rewrites because it has zero verification overhead.
- Comby is more flexible on patterns Refactron doesn't have transforms for.
- LibCST's library is bigger than Refactron's transform set.
- OpenRewrite has a richer recipe ecosystem on the Java side.

If we cannot publish this section honestly, we shouldn't publish the paper.

### Out of scope (deferred)

- Java / Go / Rust comparisons (we don't have adapters yet).
- Multi-file cross-cutting refactors (only single-transform-per-file in v1 of this paper).
- 100k+ LOC fixtures (the perf report covers that for analyze; we don't need to repeat it here).
- Comparison against IDE-built-in refactoring (IntelliJ SSR, VS Code Quick Fixes) — these are interactive, not batch.

---

## Methodology

### Fairness rules (frozen before any tool runs)

1. **Same input.** Every tool sees byte-identical fixture trees. No tool gets a hand-tuned input.
2. **Equivalent codemod.** For each tool I author the codemod (or use an existing reference impl) with the same intent: convert all `var` to `const`/`let` per the standard mutability rule. I commit the codemod source to the bench repo. Reviewers can audit each one for fairness.
3. **Cold-start.** Every measured run starts fresh: no warm caches, no prior runs in the same process.
4. **Failure is data.** If a tool fails on a fixture, that's a row in the safety table, not a reason to drop the data point.
5. **Confidence intervals.** 5 runs per cell, report median + min + max, never single best.
6. **Hardware fixed.** Same Apple M2 as `/research/perf-01`. Reproducer scripts in the repo.

### Codemod authoring per tool

For `var → const/let`:
- **Refactron** — already implemented (`var_to_const_let` transform).
- **jscodeshift** — write a `transform.js` using the standard `j.VariableDeclaration` visitor + reassignment scan. ~30 lines.
- **Comby** — pattern + rewrite template. ~5 lines.
- **ESLint `--fix`** — config enabling `prefer-const` + `no-var`. Zero custom code; this is the "stock tool" cell.

For `format → f-string`:
- **Refactron** — already implemented (`format_to_fstring`).
- **LibCST** — use `ConvertFormatStringCommand` (the reference impl Instagram ships). Zero custom code.
- **Comby** — write a `.format()` → f-string template (will be lossy on edge cases — that's the point).

### Coverage measurement

Each fixture file ships with a sidecar `expected.txt` listing line numbers of correct rewrites. After the tool runs, a checker script diffs the rewritten file against the expected output and reports:
- Correct rewrites
- Missed instances
- Wrong rewrites (rewrote something it shouldn't have)
- Broken syntax / unparseable output

### Safety measurement

After each tool's output, run:
1. `tsc --noEmit` (TS) or `python -m py_compile` (Python) on every modified file.
2. The fixture's existing test suite.

Either step exits non-zero → that cell is "unsafe", with the failing files / tests recorded.

---

## What would change my recommendation

The plan above commits to publishing data even when it's unflattering. Two outcomes are possible:

1. **Refactron wins on safety in most cells** (likely — that's the verification gate's whole job), wins on coverage in most cells, **loses on speed** for trivial single-file rewrites against ESLint and jscodeshift. This is the expected shape and supports the homepage positioning honestly.
2. **Refactron loses on coverage** for one of the two transforms (possible if a precondition fires that the others ignore). This is genuinely useful information — it tells us a transform needs work before we ship a comparison.

Either way, the paper ships. The difference is the title and the discussion section.

---

## Two questions to answer before I author code

1. **Both transforms (`var→const/let` AND `format→f-string`), or just one?**
   - Both: more complete, ~3 days.
   - Just `var→const/let`: faster, ~2 days, but we lose the Python data point.

2. **Sign-off on publishing even if Refactron loses on a dimension.**
   The plan only ships if the answer is yes. If a "we cannot publish anything that doesn't show us winning" constraint exists, we shouldn't run this benchmark — because anyone with the same fixture (which we publish) will reproduce it themselves.

---

## Deliverables

When complete:
- `bench/comparison/` directory in the public repo containing fixtures, codemods per tool, harness, and raw results.
- New `dev-docs/Research-comparison-paper-draft.md` with the prose draft, reviewed before publication.
- New `/research/comparison-01` page on the website, structured as paper 02 in the index.
- Updated `ComparisonSection` on the homepage: each cell links to the relevant paragraph in the paper as evidence. The "Read the full research paper →" link below the table now lands on a real paper, not a placeholder.

---

## Estimated time

| Phase | Effort | Days |
|---|---|---|
| Approve this plan + answer the 2 questions | user | 0 |
| Build fixtures + write codemods per tool | subagent | 1 |
| Run benchmarks + collect raw data | subagent | 0.5 |
| Synthesize into prose draft | main | 0.5 |
| Build `/research/comparison-01` page | main | 1 |
| Update `ComparisonSection` to cite the paper | main | 0 (a few line changes) |
| **Total** | | **3 days** |
