# PRD: <Feature name>

> Status: **Draft** / Under Review / Approved / Shipped
> Owner: <github-handle>
> Last updated: YYYY-MM-DD
> Linked plan: `docs/plans/YYYY-MM-DD-<kebab-name>.md` (once written)

> **Real examples to study before filling this in:**
>
> - `dev-docs/PRD.md` — the original Refactron product PRD (full scope).
> - `dev-docs/MVP_Plan.md` — narrower scope, ships-or-not framing.
> - `dev-docs/Refactron v2.1+ Roadmap.md` — multi-feature roadmap form.

## Problem

Two to four paragraphs. **What is broken or missing for the user, today.** Not "we should add X" — describe the user's experience of the gap. If you can name the user (an issue commenter, a benchmark codebase like Ansible, a downstream consumer) name them; specific beats abstract.

End this section with one sentence: _"A user trying to do X today has to Y."_

## Goals (in scope)

- One bullet per measurable outcome. "Users can do X" / "metric Y improves from A to B."
- 3–5 bullets max. If you have 10, you have 3 PRDs.

## Non-goals (out of scope)

- Bullet anything a reader might reasonably assume is in scope but isn't.
- Include the _reason_ it's out: cost, timeline, dependency, deliberate scope cut.

## Success metrics

How will you know in 30 days whether this worked? Be specific:

- "On the Ansible playground, `analyze` reports N fewer false-positive findings."
- "PR #X closed because the workaround is no longer needed."
- "Zero `silent-refusal` precondition records in the post-release nightly run."

Avoid: "users will be happier." Unmeasurable.

## Proposed approach

Two to four paragraphs describing the _shape_ of the solution. Not the implementation plan — that's `docs/plans/`. Cover:

- The user-visible surface change (new flag, new output, new behavior).
- The architectural impact (does this touch locked contracts? Does it change verification gates?).
- The 2–3 real alternatives considered and why this one wins.

## Risks

| Risk                            | Likelihood | Impact                 | Mitigation                           |
| ------------------------------- | ---------- | ---------------------- | ------------------------------------ |
| Example: detector/sidecar drift | Medium     | High (silent refusals) | Shared accept predicate + drift test |

## Open questions

- Numbered list of things that need a decision before the plan is written.
- Each question has a proposed-default in case nobody responds in N days.

## Rollout

- Releases this rides on (patch / minor / major — pick per `release-manager` rules).
- Feature flag? Default-on or default-off? When does default flip?
- Migration steps for existing users, if any.
- Deprecations triggered, if any.

## Out of scope follow-ups

Itemize the things that surfaced during PRD review but are deliberately deferred. Each one becomes a GitHub issue with the link below — so they don't get lost.

- [ ] Issue #\_\_\_ — <follow-up>
