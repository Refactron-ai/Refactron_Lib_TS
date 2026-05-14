# Show HN — pre-baked response templates

These are frozen, pre-thought answers to the questions most likely to come up
in the Show HN comment thread on Day 56. The intent is to avoid typing answers
under time pressure and to keep tone consistent across the 12-hour window.

Edit lightly to fit the actual phrasing of the comment, but do not improvise
new claims — every number and citation here is the one that's already in
README, FAQ, or `bench/results-2026-05-14.txt`.

---

## 1. Why not Cursor / Copilot?

Fair question — they're great at fluent text, which is a different problem.
The catch with using an LLM for refactors is non-determinism and no
verify-before-write: NYU's "Asleep at the Keyboard?" (Pearce et al., 2022)
found 40% of Copilot's security-relevant completions had vulnerabilities.
Refactron is the opposite shape — deterministic AST transforms with three
gates (syntax, imports, tests) before any file is written. LLMs are still in
the pipeline at Step 4 for documentation generation, where fluency matters
more than formal correctness.

— om

---

## 2. Why no Rust adapter?

Honest answer: TS + LibCST already gives multi-language reach with one engine
team. Adding Rust means rebuilding the semantic layer from scratch — there's
no LibCST-equivalent for Rust today, and tree-sitter gives you a syntax tree
without the type/scope info the verification gate needs. That's roughly a
year of catch-up work for a language I haven't seen 10 user requests for yet.
Happy to prioritize when there's clear demand — open an issue with your use
case.

— om

---

## 3. Doesn't ESLint do this?

ESLint is excellent at single-file syntactic issues and auto-fixes — I use it
on this repo. The difference is scope: Refactron's transforms are cross-file
and semantic (e.g. `callback_to_async_await` walks every caller of the
function before deciding it's safe to transform), and every change runs
through three gates — syntax + imports + tests — before being written to
disk. ESLint's autofix model is "edit then trust"; Refactron's is
"plan then verify then write". Different tools, different jobs.

— om

---

## 4. What about Comby?

Comby is great for structural search/replace and I've used it for one-off
codemods. The gap is type info and verification: Comby matches on syntax
patterns, doesn't know your imports or call graph, and doesn't run your
tests after the rewrite. Refactron is the refactor + verify pipeline for
when you need the change to land green.

— om

---

## 5. How is this different from jscodeshift?

Same AST-codemod tradition, the difference is verification-first. jscodeshift
runs the transform and leaves verifying it to you; Refactron's three gates
run automatically and refuse to write if any fail. Maintenance picture
matters too — jscodeshift's last release was v17 in 2023 and Meta hasn't
shipped against it much in 2024+; the babel-plugin-codemod community fork is
alive but separate. Refactron's transform contract is `Refactorer` in
`src/contracts.ts` if you want to compare shape.

— om

---

## 6. Why no LLM in the engine?

The numbers convinced me. NYU 40% Copilot vulnerability rate; ACM 92.45% LLM
test-generation failure rate; UTSA 19.7% AI-assisted code-review false
positives; Stripe's 2024 dev survey reporting 42% of AI-generated code is
discarded; Stack Overflow's 2024 survey showing 62% of developers don't
trust AI output. LLMs are great at fluent text — that's why Refactron uses
them at Step 4 for documentation. They're not great at formal correctness
with semantic-preservation guarantees, which is the whole job of a
refactoring engine.

— om

---

## 7. Can I write my own transform?

For now, by forking. The internal contract is `Refactorer` in
`src/contracts.ts` — each transform implements
`plan(symbol, snapshot) → RefactorPlan | null` and is registered in the
engine. A public extension API is on the roadmap post-launch; I want to
shake out the contract shape against real users before freezing it. If you
have a transform you'd want to ship, open an issue and I'll help wire it.

— om

---

## 8. Does it work on monorepos?

Yes, with one caveat. The verifier walks up to the nearest `package.json` /
`pyproject.toml` and runs the configured `testCmd` from that package's root
— so per-package refactors verify against per-package tests. Cross-package
refactors (one transform that touches packages A and B and needs both
test suites green) are out of scope at v0.2 and on the v0.3 roadmap.

— om

---

## 9. What's the perf?

Measured on Apple M2, Node 24, 5 iterations per size, raw evidence in
`bench/results-2026-05-14.txt`. 10k LOC (448 files) — 1.31s median analyze.
100k LOC (4 465 files) — 20.58s median analyze. The plan step runs ~3×
faster than v0.1 after Week 7's per-file parallelization. 500k LOC isn't in
the public bench yet (fixture generation alone is ~30s); runnable locally
with `SIZES=500000 bash bench/run-bench.sh`.

— om

---

## 10. Why MIT?

Wide adoption matters more than monetization at v0.2. The commercial side
sits in the managed-LLM "Backend" provider used at Step 4 (documentation) —
Pro users get api.refactron.dev with hosted models and rate limits; everyone
else uses their own keys or skips Step 4. The engine itself is and stays
MIT — that's the part I want every developer running locally.

— om

---

## 11. What about the obvious bug Z? (catch-all)

Thanks — open an issue at github.com/Refactron-ai/Refactron_Lib_TS/issues
with a minimal repro and I'll triage. The 3-gate verifier means the worst
case is "refactor refused with logs", not "broken tree" — but I want to
know about every false negative so the gate set can grow.

— om

---

## Tone discipline

- **Under 5 sentences.** HN respects brevity. Cut adjectives, not nouns.
- **Never defend; engage.** Find the agreeable kernel of the question first
  ("fair question", "honest answer"), then substantiate.
- **When you don't know, say so + a timeline.** "I don't know — will dig in
  tomorrow and reply" beats hand-waving every time.
- **No all-caps. No exclamation marks.** No "revolutionary",
  "cutting-edge", "game-changing", "blazingly fast", or any other
  marketing adjective. Cite the artifact (paper, file path, bench run)
  instead.
- **Sign as `om`** (lowercase) — matches HN handle conventions and reads as
  a person, not a brand.
