# ADR-NN: <Decision title>

> Status: **Proposed** / Accepted / Superseded by ADR-MM / Deprecated
> Date: YYYY-MM-DD
> Deciders: <github-handles>

> **Real examples to study before filling this in (in increasing scope):**
> - `dev-docs/decisions/01-ts-morph-vs-babel.md` — a single tool-choice decision (smallest useful ADR).
> - `dev-docs/decisions/04-verify-engine-architecture.md` — engine-level architectural call with alternatives + rollout.
> - `dev-docs/decisions/06-refactor-engine-architecture.md` — multi-component decision with explicit compliance plan.

## Context

Two to four paragraphs. What architectural pressure is forcing this decision now? Cite the constraints: locked contracts, blast radius, performance budget, dependency timeline.

Reference any related PRs, issues, prior ADRs.

## Decision

One sentence. **What you are deciding.**

Followed by 2–4 paragraphs unpacking it — the specific choice, the contract change (if any), the rollout shape.

## Alternatives considered

For each alternative (2–3 real ones, no strawmen):

### Alternative A: <name>

- Sketch of the approach.
- Why it was rejected: the specific constraint or cost that broke the tie.

### Alternative B: <name>

…

## Consequences

What's now true that wasn't before? What's now harder? What's locked in?

- **Positive**: <consequence>
- **Negative**: <consequence>
- **Neutral**: <consequence>

## Compliance

How will this be enforced going forward? Examples:

- A new lint rule.
- A new test in `tests/contract/`.
- A note in `CLAUDE.md`.
- A pre-commit hook.
- A reviewer's burden (least preferred — humans drift).

If the answer is "we'll just remember," the ADR doesn't ship until enforcement is real.

## Rollout / migration

If the decision invalidates existing code/usage:

- What changes for current consumers?
- What's the migration path (codemod, deprecation cycle, hard break)?
- What's the timeline?

## Open questions / follow-ups

- [ ] Issue #___ — <follow-up>
