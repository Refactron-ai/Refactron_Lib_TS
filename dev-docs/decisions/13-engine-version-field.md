# ADR-13: VerdictReport carries the producing engine version

> Status: **Accepted**
> Date: 2026-08-18
> Deciders: @omsherikar

## Context

`VerdictReport.reportVersion` has always answered one question: *can I parse this?* The doc text says so directly (`docs/mcp/tool-reference.mdx`: "Schema version, currently `1`. Read it before relying on any field below.").

It does not answer a second question that now has two different answers inside a single release line: *what did `SAFE` mean when this report was written?*

- **ADR-12** made a narrowed `testCmd` floor the verdict at `UNPROVEN`.
- **ADR-11** made `SAFE` require every coverable changed statement to have executed.

Both changed the **semantics** of `verdict` while changing nothing about the report's **shape**, so both correctly left `reportVersion` at `1`. Bumping it would have been a retype (`1` becomes `1 | 2`) shipped to buy a number, and would train consumers to re-validate parsing that did not change.

Both ADRs independently reached for a producer version as their follow-up. Two documents arriving at the same missing thing is the signal that the gap is structural rather than incidental.

Today a consumer can recover each boundary by archaeology on the report body: a `SAFE` carrying `changedStatements.covered < total` was earned under the old statement rule; the presence of `testScope` implies an engine that floors. Both work. Neither generalises. The next semantic tightening needs a third bespoke trick, and one of them will eventually not be recoverable from the body at all.

## Decision

**`VerdictReport` carries `engineVersion?: string`, the `package.json` version of the engine that produced the report.**

**Name: `engineVersion`.** Both merged ADRs already used that name in their follow-up sections. Two documents agreeing beats marginal aesthetics, and the alternative `producedBy` invites a non-version value later (a hostname, a CI job id), which is exactly the ambiguity a published field should not carry.

**Optional, not required.** It matches every other additive field on the report; it preserves "absence means an engine older than this change", which is the discriminator for the 0.4.0 reports already in the wild; and it avoids forcing a retype on consumers who construct a `VerdictReport` in their own tests.

**`reportVersion` stays `1` and stays.** The two fields answer different questions and both are needed. The docs must say which is which in one sentence each, or consumers will reach for the wrong one.

**Stamped in `src/verify/verify-diff.ts`, not in `fuseVerdict`.** `verdict-fuse.ts` documents itself as pure with no I/O, and reading `package.json` inside it would make that header false. `verify-diff.ts` is already the I/O layer and is the only production path to a report, so both the CLI and the MCP surface receive the field.

**Tests assert a semver shape, never the literal version.** A literal breaks on every release bump, which trains people to update assertions without reading them — and an assertion nobody reads is worse than no assertion.

## Alternatives considered

### Alternative A: bump `reportVersion` for each semantic change

Rejected on three grounds. The docs define it as a schema version, so bumping it for a rule change misdirects every consumer that checks it. It is itself a breaking TypeScript change (`reportVersion: 1` becomes `1 | 2`). And it is strictly less informative than the report body already is: a version number says *when* the meaning changed, while `changedStatements` says *which runs* were affected.

### Alternative B: keep relying on body archaeology

Rejected because it does not generalise, as set out in Context. It also puts the burden on every consumer to know two undocumented tricks, and those tricks are only obvious to someone who has read the ADRs.

### Alternative C: a capability descriptor rather than a version

A structured object naming which rules were active (`{ floorsNarrowedScope: true, requiresAllStatements: true }`) is strictly more expressive than a version string.

Rejected as premature. It freezes a taxonomy of rules we are still adding to — three in one release line so far — and a wrong taxonomy in a published field is worse than a version string that promises nothing beyond "look this up". A version is a stable pointer to a changelog that can describe anything.

## Consequences

- **Positive**: a stored `SAFE` can be interpreted correctly a year later, without knowing the archaeology.
- **Positive**: future semantic tightenings stop relitigating the `reportVersion` question. The answer is now "no, and `engineVersion` already covers it".
- **Positive**: one implementation of the version read instead of three.
- **Negative**: every report now embeds a string that changes on each release, so any test asserting the whole report by equality will churn. Mitigated by asserting a shape; called out here so nobody "fixes" it by pinning a literal.
- **Neutral**: no verdict changes. Additive field, `reportVersion` unchanged, `src/contracts.ts` untouched.

## Compliance

- The field cannot be renamed after release, so the name is fixed by this ADR.
- Tests on both serialized surfaces (`--json` and the MCP tool) assert presence and a semver shape. Removing the stamp fails them; verified by doing exactly that before merge.
- `src/engine-version.ts` carries a header explaining why `src/cli/index.ts` keeps its own copy of the version read, so nobody "finishes the refactor" and regresses the sub-10ms `--version` fast path.

## Rollout / migration

Additive. Consumers ignoring unknown keys are unaffected. Reports produced before this change simply lack the field, which is itself the signal that they predate it. Ships in 0.4.x per the version policy in `COMMIT_CONVENTIONS.md`.

## Open questions / follow-ups

- [ ] Whether the PyPI wrapper's version should appear when the CLI is invoked through it. Today `engineVersion` is the Node engine's version, which is the thing that produced the verdict; the wrapper is a shim and arguably irrelevant. Revisit only if a report is ever produced by something other than this engine.
