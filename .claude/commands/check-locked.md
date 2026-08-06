---
description: Verify the locked-contract invariant: fails if any locked file has been modified on the current branch.
---

Check whether the current branch modifies any locked file. The locked files are:

- `src/contracts.ts`

Steps:

1. Determine the current branch's diff base (`git merge-base HEAD main`).
2. Run `git diff --name-only <base>..HEAD` and check for any of the three locked paths.
3. If any locked file appears in the diff:
   - Show the user which file(s) and the diff.
   - State: this requires a major version bump and a written ADR in `dev-docs/decisions/` BEFORE the PR is opened. Per `CLAUDE.md`, PRs that touch these files are closed without review.
   - Ask if the user wants you to dispatch the **principal-engineer** subagent to evaluate whether the change is genuinely necessary, draft the ADR, and plan the migration.
4. If no locked file is modified, report: "Locked-contract invariant holds, branch is safe to PR."

This command is non-destructive: read-only checks only.
