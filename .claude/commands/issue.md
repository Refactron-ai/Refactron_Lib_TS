---
description: Shape an intent into a well-formed GitHub issue and file it. Routes through the delivery-lead agent for scope, acceptance criteria, and sizing.
---

File a GitHub issue for: **$ARGUMENTS**

This project works issue first: every unit of work starts here, gets a branch named for the issue, and ends in a PR that closes it. Your job is to make the issue worth having, not to start the work.

## 1. Gather context before shaping

Do this yourself, quickly, so the agent shapes against reality rather than guesses:

- `gh issue list --limit 30 --state all --search "<keywords>"` to check for a duplicate or a related open issue. If one exists, say so and ask whether to comment on it instead of filing a new one.
- Skim the relevant source or docs so the issue can cite real paths. A one-line `grep` beats a vague description.
- If the conversation already contains a reproduction, a failing command, or a measurement, keep it verbatim. Real output is the most valuable thing an issue can carry.

## 2. Dispatch delivery-lead to shape it

Invoke the **delivery-lead** subagent (model `opus`). Give it the intent, everything you gathered, and this instruction:

> Shape this into a well-formed issue for the Refactron repo. Answer the four questions from your role definition: problem as observable behavior, evidence, acceptance criteria someone else could verify without asking, and explicit non-goals. Add a verdict-integrity note if this touches gates, coverage, attribution, or verdict fusion, naming which verdict could go wrong and what proves it does not. Add a blast-radius note if it touches a locked contract or the published report shape. Return the issue body ready to file, a suggested title (imperative, under 70 characters), suggested labels, and a size verdict of ready / split / blocked-on-decision with your reasoning. If it needs splitting, give me each issue separately rather than one issue with a checklist of unrelated work.

## 3. Review the shaping before filing

Read what came back and check it honestly:

- Would a stranger know when this is done? If not, the acceptance criteria are decoration.
- Is the evidence real, or did the agent invent a plausible-sounding reproduction? Never file fabricated output.
- If the verdict is **split**, file the separate issues and link them, rather than filing one vague one.
- If the verdict is **blocked-on-decision**, file the decision issue first and reference it as a blocker.

## 4. File it

Check available labels first (`gh label list`) and use only labels that exist. Then:

```bash
gh issue create --title "<title>" --body-file <path> --label "<existing labels>"
```

Write the body to a file in the scratchpad rather than inlining it, so multi-line markdown survives intact.

## 5. Report

Give the user the issue number and URL, the acceptance criteria in one or two lines, and the size verdict. Then tell them the next step is `/start <number>`.

Do not begin implementing. Filing the issue is the whole job.
