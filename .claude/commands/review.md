---
description: Adversarial pre-PR review of the current branch against Refactron's project rules. Routes through the staff-code-reviewer agent.
---

You are running the pre-PR review for the user's current branch. Invoke the **staff-code-reviewer** subagent with the brief below. Do NOT do the review yourself — your job is to dispatch and relay the verdict.

Brief for the staff-code-reviewer:

> Review the current branch (`git diff main..HEAD`) of the Refactron codebase adversarially before the user opens a PR. The session's prior conversation may include context about what was changed and why; treat that as the author's narrative and verify it against the diff.
>
> Walk the full review checklist from your role definition (`.claude/agents/staff-code-reviewer.md`). Be especially strict about:
>
> 1. Locked files (`src/contracts.ts`, `src/core/models.ts`, `src/adapters/interface.ts`) — if any are touched, BLOCK and demand an ADR + major-version plan.
> 2. Blast radius on every new `CodeIssue`.
> 3. Atomic writes (no direct `fs.writeFile`).
> 4. TDD evidence — run the new tests on the pre-fix state to confirm they actually fail.
> 5. Commit messages: Conventional Commits, no `claude`, no co-author trailers, no `--no-verify`.
> 6. Test discipline: no mocked Python sidecars, no tests that pass with `it.skip`.
>
> Report as APPROVE / REQUEST CHANGES / NEEDS DISCUSSION with the structured format from your role. Quote file:line for every issue. Severity tag every finding (BLOCK / IMPORTANT / NIT).

After the subagent returns, relay its verdict verbatim to the user, then ask whether to fix any BLOCK/IMPORTANT items before opening the PR.
