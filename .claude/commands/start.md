---
description: Pick up a GitHub issue: read it, branch for it, plan the approach, and begin test-first. The entry point for all implementation work.
---

Start work on issue **#$ARGUMENTS**.

## 1. Read the issue, and take it seriously

```bash
gh issue view $ARGUMENTS --json number,title,body,labels,comments
```

Extract the acceptance criteria verbatim and keep them in front of you for the rest of the session. They are the definition of done, and you will be asked to prove each one at `/ship` time.

Stop and check three things before writing anything:

- **Is it still accurate?** Code moves. If the issue describes behavior that no longer exists, say so and update the issue before working from it.
- **Is it actually ready?** No acceptance criteria, or a problem statement that is really three problems, means it needs shaping. Dispatch **delivery-lead** to fix it rather than guessing at intent.
- **Does it touch a locked contract?** `src/contracts.ts`, `src/core/models.ts`, `src/adapters/interface.ts`. If yes, stop: that needs `principal-engineer` and an ADR, not an implementation branch.

## 2. Branch

Name the branch for the issue so the link survives outside GitHub:

```bash
git checkout main && git pull origin main
git checkout -b <type>/<number>-<slug>
```

`<type>` matches the Conventional Commit type the work will use (`fix`, `feat`, `docs`, `test`, `chore`, `refactor`, `perf`). Example: `fix/91-crlf-fixture-eol`.

Confirm the working tree was clean before branching. If another session left changes, deal with that first rather than building on top of it.

## 3. Plan before typing

For anything beyond a one-line change, decide and state:

- The approach, and the alternative you rejected with one line on why. If two approaches are genuinely close, that is a `principal-engineer` question.
- Which specialist should implement it, if it is not you: `python-sidecar-specialist` for LibCST or sidecar work, `typescript-architect` for engine and ts-morph work, `dx-engineer` for CLI surface, `documentation-engineer` for docs.
- **The failing test you will write first**, named. This project is test-first, and a regression test that was never red is not evidence.
- For verdict-path work: which verdict could go wrong, and the test that pins it. A change that adds leniency anywhere near `SAFE` needs its safety case written before the fix.

## 4. Work

Follow the house rules that already exist rather than re-deriving them: `CODE_STYLE.md`, `COMMIT_CONVENTIONS.md`, and the test-first discipline in `.claude/agents/test-engineer.md`.

Two habits that have repeatedly paid off in this repo:

- **Prove the test is red first.** Run it against the pre-fix state and paste the failure. Several "regression tests" here turned out to pass identically on both trees.
- **Surface what you find.** Work that uncovers a second bug is normal. File it with `/issue` and link it; do not silently fold unrelated fixes into this branch.

Commit in logical units with Conventional Commits, subject under 72 characters, no AI names, no co-author trailers. The commit-msg hook enforces the message shape; the granularity is on you.

**One logical change per commit.** A small fix gets its own commit, even when several came out of the same sitting. The test is whether the commit can be reverted on its own without taking unrelated work with it. Bundling a review's findings into one large commit destroys revert granularity and makes `git bisect` resolve to "one of these ten things". See `COMMIT_CONVENTIONS.md`.

## 5. Hand off to /ship

When the acceptance criteria are met and the suite is green, run `/ship` (not `gh pr create` directly). That runs the full gate and the review cadence before anything opens.
