---
description: Three-lens adversarial review of the current branch (correctness, architecture, tests) run in parallel. Use before /ship, or any time you want the work attacked.
---

Review the current branch adversarially.

One reviewer finds what one reviewer finds. This project runs three lenses in parallel because that cadence has repeatedly caught what a single pass missed, including two false SAFEs that were introduced by the fix for a third and would otherwise have shipped.

## 1. Establish the diff

```bash
git branch --show-current
git log --oneline main..HEAD
git diff --stat main...HEAD
```

If the branch name carries an issue number, read the issue too: a reviewer who knows the intended outcome catches "the diff does something else", which a reviewer reading only code cannot.

## 2. Dispatch three reviewers in one message

Send all three in a single message so they run concurrently. Each on `opus`. Each read-only, because a reviewer that edits is a reviewer that stops arguing with itself.

Tell every one of them the branch, the base, the file scope, and this: **run the commands yourself, do not trust the description**.

**staff-code-reviewer** owns correctness and safety:

> Attack this branch for defects, in this order: a false SAFE first (the only unforgivable outcome in this product), then any other verdict that could be wrong, then ordinary bugs. If you suspect a regression, reproduce it against `main` as a control and paste both outputs. Check the locked-file invariant, atomic writes, honest degradation (an unmeasurable thing must report unknown, never a confident conservative-sounding lie), and commit hygiene. Run the full suite, typecheck, lint, and build yourself. Rank findings Critical / Important / Minor with file:line, a concrete failure scenario, and a suggested fix. Verdict: SHIP / FIX-THEN-SHIP / MAJOR REWORK.

**principal-engineer** owns the contract and the architecture:

> Does this keep faith with what the docs promise and the architecture assumes? Read `docs/verification/verdicts.mdx` as the public contract before judging. Name any place the change quietly widens or narrows a documented guarantee. Flag anything that becomes expensive to change once published, especially the shape of `VerdictReport`, which is serialized verbatim by the MCP tool and `--json`. Where a decision is genuinely a product call rather than a code opinion, state your position plainly, because the founder needs an answer and not a survey. Verdict: SHIP / FIX-THEN-SHIP / MAJOR REWORK.

**test-engineer** owns whether the tests prove anything:

> Would each new test fail on `main`? Verify rather than assume, in a throwaway worktree if that is what it takes, and name any test that passes on both trees, because it proves nothing. For a safety fix, confirm the safety case is pinned in both directions. List the edge cases with no guard and, for each gap, the exact test you would add with the assertion that matters. Check that no existing assertion was weakened and that fixtures are deterministic and self-cleaning. Verdict: SHIP / FIX-THEN-SHIP / MAJOR REWORK.

Add a fourth lens when the branch calls for it: **security-engineer** for anything touching exec, file writes, or dependencies; **dx-engineer** for CLI output and error messages; **documentation-engineer** for user-facing wording.

## 3. Consolidate, do not relay three times

When all three return, merge their findings into one ranked list. Deduplicate honestly: two reviewers reaching the same finding independently is a strong signal, so say that rather than hiding it as a duplicate. Where they disagree, say so and give your own read.

Then report to the user: the three verdicts, the consolidated findings worst-first, and a single recommendation. Lead with any Critical finding, in plain language, before the summary.

## 4. Fix in one wave

Apply the consolidated findings together, re-run the gate, and re-verify any safety-critical fix specifically. Then say which findings you fixed, which you deferred, and why.

If a review finds a defect that the branch itself introduced, say that out loud rather than quietly folding it in. That pattern has happened three times here and is worth naming every time.
