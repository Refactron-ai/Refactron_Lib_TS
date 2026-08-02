---
description: The pre-PR gate. Verifies the work against its issue, runs the three-lens review, then opens a PR that closes the issue. Use instead of gh pr create.
---

Ship the current branch.

Nothing here is ceremony. Every step exists because skipping it has cost this project a real defect: a false SAFE, a test that proved nothing, a red CI merged on assumption.

## 1. Establish what this branch claims

```bash
git branch --show-current
git log --oneline main..HEAD
git diff --stat main...HEAD
```

Recover the issue number from the branch name (`<type>/<number>-<slug>`) or from `$ARGUMENTS`. Read the issue and pull out its acceptance criteria:

```bash
gh issue view <number> --json number,title,body
```

If there is no issue, stop and say so. Filing one now with `/issue` costs a minute and is the point of the workflow. Proceed without one only for a genuine typo fix, and say out loud that you are skipping.

## 2. Run the gate yourself, before anyone reviews

```bash
npm run typecheck && npm run lint && npm run format:check && npm test
```

Report the real numbers (files, tests, failures). If anything is red, fix it before going further: a review of broken code wastes the reviewer and teaches you nothing.

Then check the invariants that CI enforces late and cheaply here:

- `node dist/cli/index.js analyze src/ --fail-on high` after a build, since our own self-analysis gate blocks the PR and has caught real style violations in new sidecar code.
- Locked files untouched: `git diff --name-only main...HEAD | grep -E 'src/(contracts|core/models|adapters/interface)\.ts'` must be empty.
- Commit hygiene: Conventional Commits, subjects under 72 characters, no AI names, no co-author trailers.

## 3. Verify the work against its issue

Dispatch **delivery-lead** (model `opus`) with the issue body, the branch diff, and this instruction:

> Judge whether this branch satisfies its issue. Walk each acceptance criterion and demand a named proof: a test name, a command with real output, a measurement. Flag any criterion met only by assertion. Confirm the regression test was red before the fix, and say so if that cannot be shown. Confirm the PR-ready description would match the diff. Return READY TO SHIP, NOT DONE with the specific missing evidence, or SCOPE CHANGED with a rewritten issue.

## 4. Run the three-lens review

Do not settle for one reviewer. In this project the parallel cadence has repeatedly caught what a single pass missed, including two false SAFEs introduced by fixes for a third. Dispatch these **in one message so they run concurrently**, each on `opus`, each read-only and told to stay in its lane:

- **staff-code-reviewer**: correctness and safety. For verdict-path work, tell it explicitly to hunt for a false SAFE and to reproduce any suspicion against `main` as a control.
- **principal-engineer**: does this keep faith with the documented contract and the architecture; is anything here painful to change after it ships.
- **test-engineer**: red-first credibility, whether the safety case is pinned in both directions, and which edge cases have no guard.

Give each the branch name, the issue, and the diff scope. Consolidate their findings into **one** fix wave rather than patching three times.

## 5. Fix, then re-verify

Apply the findings. Re-run the gate. If a fix touched the verdict path, re-run the specific safety test and paste its output. Then say plainly which findings you fixed, which you deliberately deferred, and why.

## 6. Open the PR

Write the body to a file (multi-line markdown does not survive inlining), then:

```bash
gh pr create --title "<conventional commit style title>" --body-file <path>
```

The body must contain:

- **What** and **why**, in prose a reviewer can read in thirty seconds.
- `Closes #<number>` so the issue closes on merge.
- The evidence: real numbers, real command output, the before and after for a bug fix.
- What you could not verify locally, stated rather than omitted.
- Known limitations that survive this PR.

Honesty rule for the description: if the diff does not do something, do not write that it does. The description outlives the branch.

## 7. Watch CI, then report

Poll until the checks settle, then report the true state. **Never merge on assumption, and never call a red check flaky without evidence.** If something fails, diagnose it: this project has seen a genuine Windows-only CRLF bug, a version-dependent coverage assertion, and our own self-analysis gate, all of which first looked like noise.

Leave the merge decision to the user unless they have already said to merge on green.
