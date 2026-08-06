# Refactron: Migration Strategy

**4 August 2026. Written to be executed by one person with agents, starting Monday.**

This document picks a spine and discards the rest. It does not average the options that were argued. Where the research was thin or a claim was unverified, it says so instead of dressing it up. Code claims in this document were checked against the working tree on branch `docs/mcp-tab` before writing.

---

## 1. Positioning

**When something else writes a 400 file change, Refactron tells you which parts of it your own tests actually prove, and refuses to call the rest safe.**

That sentence was not sellable three years ago because nobody was merging changes they had not written. The reviewer was the author, and self knowledge substituted for evidence: you knew which lines you had touched and why, so "the suite is green" was a supplement to understanding rather than a replacement for it. That relationship inverted in 2026. The author is now frequently a machine optimised to report completion, the reviewer has no mental model of the diff, and every tool in the loop grades its own output. The industry's own yardstick moved with it: MigrationBench, FreshBrew and ScarfBench all define migration success as "the repo's own tests pass," and Anthropic's Bun Zig to Rust port passed 100 percent of the existing suite before merge and produced 19 post merge regressions anyway. The gap between green and proven stopped being an academic point and became the thing a reviewer needs a number for. Nobody sells that number.

Note what this sentence is not. It is not "the verification layer for AI assisted software development." Qodo raised 70 million dollars in March 2026 for that exact phrase, Axiom Quant raised 200 million dollars at a 1.6 billion dollar valuation, and Sonar's homepage is "Code Verification for the AI Era." That naming fight is over and it was never winnable from zero. The ownable claim is narrower and better: the only verifier that refuses to say SAFE without evidence, and names exactly which evidence is missing.

---

## 2. The objection that decides everything: the oracle moves

In a framework major, the test suite changes with the source. Angular 20 and 21 migrate Karma to Vitest. Spring Boot 2 to 3 drags JUnit 4 to 5. Django 5.0 removed the response object form of `assertFormError` and `assertFormSetError`. When the oracle is inside the diff, "the suite is green" means "the new tests pass against the new code," which is a tautology and proves nothing about preservation.

The founder's thesis, stated as "in a migration, behaviour preserving IS the specification, so the verifier defines done," is false as written. There is no specification left when the specification is part of the change. Refactron's own code already concedes half of this: `verdict-fuse.ts:53-56` records `testFilesChanged` with the comment "A note, not a verdict input," specifically because an agent that weakens tests can otherwise ride a green verdict. The engine detects the problem and deliberately does nothing about it.

Here is the answer, in three parts. Say all three out loud, including the third.

### 2.1 Split the migration by whether the oracle moves

A framework upgrade is not one change. It decomposes into three regions with different epistemic status:

- **Region A, preparation under the old pin.** Deprecated API removed while the old library is still installed. Library fixed, tests fixed, source changes. The oracle predates the diff by construction. This is ordinary verification and Refactron grades it today.
- **Region B, the flip.** Manifest and source change together, tests untouched. Oracle is fixed but the environment moves. Refactron cannot grade this today at all, and section 5 says why and when it can.
- **Region C, the test suite migration.** Test files change. **No test based method can verify this region. Not Refactron, not AWS Transform, not Copilot app modernization, not a frontier agent.** Anything that reports green here is reporting a tautology.

Region C is where the doctrine earns its keep. Every competitor runs the migrated suite against the migrated code and calls the result validation. That is not a small technical quibble, it is the central claim of their product being circular. Refactron's position is to name region C, refuse to issue SAFE inside it, and then, instead of stopping there, produce the one non circular measurement that is still available.

### 2.2 The frozen oracle, as a floor and not a partition

Run the **pre migration test files** against the **post migration source**, under the **post migration dependencies**. Base tests, head code, head deps.

The temptation is to partition the results into "failed because a test API moved" versus "failed because behaviour broke." Do not build that. Partitioning requires a per framework, per version catalogue of which test APIs changed, which is an OpenRewrite style recipe corpus wearing a disguise, and section 5.6 refuses recipe corpora for good reasons. A single failing test can also belong to both classes at once, which makes the partition unsound as well as expensive.

Report a floor instead:

> Of your 1,240 pre migration tests, 1,102 ran unchanged against the migrated code and passed. Those tests execute 61 percent of the changed statements. 74 test files could not be collected because their imports moved. 64 tests failed. Here they are.

That is monotone, cheap, catalogue free, and true. It reuses the hardest asset Refactron already owns: statement level coverage attribution (`coverage-attribution.ts`). The headline is not the test count, it is the second number, **the fraction of changed statements executed by tests that predate the change**. That is a genuine preserved behaviour measure and nothing in this market computes it.

It degrades honestly. Module path drift causes collection errors, which in pytest are per file and all or nothing. Those are reported as "could not be run," never as failures, and they lower the floor. Worst case the floor is zero percent and the report says so, which is still more information than a green tick.

### 2.3 What it proves and what it does not

**Proves:** that the specific behaviours exercised by unchanged pre migration tests survived the change, under the new dependency set. That is a real, non circular preservation claim about a named subset.

**Does not prove:** anything about code the old tests never touched; anything where the old tests were themselves wrong; anything about behaviour that changed only under new library defaults the old tests do not exercise; anything at all in the region where collection failed. The floor is a lower bound on preservation, not a verdict.

**Consequence, stated plainly so it is never quietly reversed later:** once `testFilesChanged` becomes a verdict input, **SAFE is permanently unreachable on any diff that touches a test file, including a complete framework major.** There is no roadmap item that changes this and none should be added. Refactron's answer to region C is a quantity, not a verdict. Anyone who wants a green tick on a test changing migration is buying a lie, and the tools selling it are cheaper than Refactron will ever be.

---

## 3. The principle that makes this executable by one person

**Refuse your way to shippable.**

Every hard subsystem in this plan gets a narrow supported path and a named, machine readable refusal for everything else. Dependency environments: support projects with a lockfile that `uv` or `npm ci` can install deterministically, refuse everything else with `environment-not-reproducible`. Test runners: support the ones that exist, refuse cleanly instead of guessing. Coverage: Python today, TypeScript later, refuse the rest.

This is not a compromise, it is the doctrine applied to the roadmap. A funded team building an environment layer tries to install arbitrary repositories, which is genuinely a multi quarter problem and is exactly what killed the phase0b corpus effort (three attempts, six repos, inconclusive by scarcity, and the recorded reason was that a repo which installs on modern Python and runs its suite fast enough could not be found). A solo founder building the same layer supports the reproducible case and refuses the rest by name. The refusal is honest, it costs the user nothing but a clear message, and it converts an unbounded problem into a bounded one.

Use this test on every roadmap item: **can the hard part be replaced by a named refusal without lying?** If yes, ship the narrow version now. If no, it is not a solo item and section 8 must mark it.

---

## 4. The first wedge

**Grade somebody else's Django 4.2 to 5.2 LTS upgrade.**

Not perform it. Grade it. The diff comes from `django-upgrade`, from an agent in Claude Code or Cursor, or from a human. Refactron is the second opinion.

### Why Django and why this hop

| Candidate | Call | Reason |
|---|---|---|
| **Django 4.2 to 5.2 LTS** | **Chosen** | Django 4.2 LTS reached EOL 7 April 2026, so every release below 5.2 is unsupported and the laggard cohort is in market now. 5.2 LTS runs to April 2028, so the destination is stable (do not target 6.0, whose standard window ends April 2027). Python is the only language where Refactron does coverage attestation. Django applications ship suites more often than most cohorts, though see the caveat below. |
| SQLAlchemy 1.4 to 2.0 | Demo only | Refactron's own G0 measured 0 of 227 safe shape sites as test covered, twice, byte identical. 2.1 GA is imminent and is a news hook. Not a revenue thesis. |
| Python 3.10 to 3.12 | Later, and harder than it looks | A runtime bump is the worst case for the environment layer because every C extension rebuilds against a new ABI. The code side transforms are already free in Ruff and pyupgrade. The 31 October 2026 EOL date is flagged UNVERIFIED in the research. |
| Angular majors | Refused for now | Real recurring dates in a supported language, but `ng update` does the transform free, Angular 20 and 21 migrate the test runner itself, and TypeScript caps at UNPROVEN until coverage attestation ships. |
| CommonJS to ESM | Deleted | `require(esm)` stabilised in Node 24. The forcing function was removed. |
| Java, .NET, Spring, PHP, Ruby, COBOL | Refused | Seven of the hardest deadlines in the next six months live here and Refactron's adapters serve zero of them. Entering means fighting Moderne, Copilot app modernization, AWS Transform and Diffblue simultaneously with no adapter. |
| Vue 2, legacy PHP | Refused | Enormous installed bases, essentially no suites. Every verdict UNPROVEN. Installed base is not addressable market when the oracle is a prerequisite. |

**Caveat, stated because it is load bearing.** "Django apps almost always ship a runnable suite" appears in the research as an assertion with no measurement behind it, and Refactron's own phase0b evidence points the other way for open source repos specifically. The week 10 measurement below exists to test it. Do not build anything downstream of that number before it exists.

### The first sellable artifact

Additive fields on the existing `VerdictReport`, which already carries `reportVersion` and whose stated policy makes additive fields safe:

```
frozenOracle: {
  collected, passed, failed, uncollected,
  changedStatements: { total, coveredByPassingBaseTests }
}
```

Rendered as a **Migration Evidence Report**: the verdict, the gate results, the import delta, the frozen oracle floor, and an explicit list of what could not be proven and why. The headline is one number: **the percentage of changed statements executed by tests that predate the change.**

The commercial framing for that number, which survives even if it is low: it is a work estimate. "We can prove 23 percent of this migration. The other 77 percent is hand review hours." Nobody bidding or approving an upgrade can currently produce that line, and they need it.

### What is explicitly not sold here

Django emits `RemovedInDjango50Warning` and friends as `DeprecationWarning` subclasses at the call site. Running the existing suite under `-W error::DeprecationWarning` on a repo pinned at 4.2 yields, free, first party, and coverage attributed by construction, every deprecated site the suite exercises. `django-upgrade` then does the rewrite half, free and maintained.

**Refactron does not sell a Django deprecation inventory.** That is the strongest single attack on the narrow wedge stance and it is correct. Building a Django detector set would also mean building transform front ends and needing a `TransformId` literal, which sits in the locked `src/contracts.ts` (the SQLAlchemy detector had to cast `as never` to dodge exactly this). Refactron sells the thing the free tools cannot produce: what happens to behaviour when the change is applied, measured against an oracle that predates it.

### What would prove or disprove the thesis

Pre declare this in writing before the run, as G0 did, and publish the result either way.

**Measurement (week 10 to 12):** take five Django repositories pinned below 5.2 that install reproducibly and run their suite in under ten minutes. Produce a real 4.2 to 5.2 upgrade diff for each using `django-upgrade` plus an agent. Run the frozen oracle. Record, per repo, the percentage of changed statements executed by passing base tests, and the percentage of base test files that fail to collect.

**Pre declared thresholds:**
- Median floor at or above 25 percent across the five repos: proceed. The number is worth reading and worth paying for.
- Median floor below 25 percent but collection failure below 40 percent: the mechanism works and coverage is the problem. Migration is not the workload; keep the frozen oracle and point it at same version agent diffs, where coverage is better and the oracle is fixed by construction.
- Collection failure at or above 40 percent: module path drift dominates and the frozen oracle is structurally weak on framework majors. Abandon migration as a positioning, keep it as a capability.

Five repos, not forty. Chosen for reproducibility rather than representativeness, and say so when publishing. The previous attempt at a representative corpus consumed three attempts and six repos and returned inconclusive by scarcity; repeating that on a shorter clock is the single most predictable failure available.

---

## 5. Sequencing

Nothing in this plan is a transform. The commodity transform roadmap was shelved on 26 June 2026 with "do not relitigate" attached, and it stays shelved. The reasoning has only got stronger: stock Claude 4.5 Sonnet clears 71.67 percent pass@1 minimal on MigrationBench with no migration product, `ng update` is free, Ruff and pyupgrade already cover nearly everything on the shelved list, and Refactron's transform engine is one file in and one file out (`src/transform/types.ts`) against a `FileChange` contract in locked `src/contracts.ts` that has no create, delete or rename operation. Multi file coordinated rewriting is a locked contract change plus a real module resolver, for a solo founder, against OpenRewrite's 7,200 recipes and a Lossless Semantic Tree.

### Monday, and weeks 1 to 2: make the verdict honest at migration scale

All four are correct independent of whether migrations are ever pursued. None depends on a corpus. All are solo executable.

1. **Ratio gated SAFE.** `coverage-attribution.ts:106-109` already computes `changedStatements: { total, covered }` and the comment states outright that it does not feed the verdict rule. Today SAFE fires when every changed file has at least one changed statement that executed (`coverage-attribution.ts:215-220`), so a 500 file sweep can reach SAFE on 500 statements out of tens of thousands. The false SAFE surface grows linearly with diff size and migration is what makes diffs large. Gate SAFE on the ratio above a threshold once the diff exceeds N files. One file change to `verdict-fuse.ts`. Highest value per hour item in this document.
2. **`testFilesChanged` becomes a verdict input.** New reason string, SAFE unreachable. This is section 2.3 encoded in the engine.
3. **Diff intake accepts creates and deletes.** `diff-input.ts:237-260` refuses deletions, copies, renames and submodule bumps outright. Real migrations move and delete files, so Refactron currently cannot grade migration output at all. Accept creates and deletes. Model renames as delete plus create and degrade coverage to unknown for the created path rather than pretending attribution carries across. Keep the belt and braces raw text scan.
4. **Remove `requireAuth` from `verify-diff` and `preflight`** (`verify-diff-command.ts:129`, `preflight-command.ts:53`). A tool sold as running entirely locally that calls `api.refactron.dev` before it will grade anything is friction pointed at the exact evaluation you want. Refactron's own G0 driver had to import the library by file path to route around it. Replace with opt in anonymous usage counting, default off. Be honest that this removes the only current telemetry surface: awareness, not friction, is the binding constraint at 174 downloads in 30 days, so this is cheap insurance rather than a growth lever.
5. **Extend `runners/detect.ts`.** It is 50 lines and knows vitest, jest and pytest. Add `manage.py test`, tox, nox, `uv run` and `poetry run`. Every Django engagement hits this in the first hour.

### Weeks 3 to 5: frozen oracle v1, same environment

Base test files checked out into the head shadow, run against head source, under the host's currently installed dependencies. No environment layer required.

This ships value immediately against the workload that actually exists today: agent diffs that rewrite source and tests together in the same version. That is common, it needs no corpus, and it turns the week 1 SAFE disqualifier from a pure downgrade into a downgrade plus a number. Prove the primitive here before betting migrations on it.

### Weeks 6 to 10: the environment layer, narrow and refusing

`shadow-tree.ts:26` symlinks `node_modules`, `.venv` and `venv` back into the user's real tree. In a version bump the dependency version is the change, so the shadow always runs new code against the old installed library. There is no third state: install the new library and the baseline goes red, do not install it and the verdict describes an execution that never existed. Any shortcut that lets a manifest diff reach SAFE certifies green tests against the old library, which is the unforgivable defect by definition.

Build: per verification dependency materialisation into the shadow, cached by lockfile hash. **Supported path only:** Python via `uv` from a lockfile or a fully pinned requirements file, Node via `npm ci` from `package-lock.json`. Everything else returns UNPROVEN with reason `environment-not-reproducible` and names what is missing. Then dual environment baseline: run (base code, base deps) and (head code, head deps).

This also fixes the coverage bail. `verify-diff.ts:93-100` returns unknown coverage the instant any edited file is not `.py`, which every real migration diff triggers via `requirements.txt`. The correct replacement rule, and it needs its own red first test because this is precisely where a false SAFE would come from: classify each edited file as attestable source, dependency manifest, or inert. Coverage may be assessed when every non attestable file is either inert or a manifest whose change is covered by the dual environment baseline. Anything else stays unknown.

**Scope honesty:** this is bounded only because of the refusal. Unpinned requirements files, poetry, Pipfile, conda, C extensions needing system libraries, and base environments that no longer resolve on a current interpreter are all real and all refused in v1. Expect the supported path to cover a minority of repositories at first. That is a measurement to publish, not a failure to hide.

### Weeks 10 to 12: frozen oracle v2 and the measurement

Frozen oracle under head dependencies, which makes it migration capable. Then run the five repo measurement in section 4.

### Months 4 to 6: TypeScript coverage attestation

Istanbul format JSON, emitted by Vitest, Jest and nyc, already carries a `statementMap` with per statement start and end positions, which is exactly the extents Refactron had to reconstruct with a LibCST sidecar for Python. This is a port with a better data source, not research. Add a mandatory "source map disagreed, therefore UNKNOWN" degradation, because bad v8-to-istanbul mappings are the documented failure mode and this is the one place a TypeScript false SAFE would enter. Solo executable, weeks not a quarter, but the correctness surface is subtle and it should be attacked with the same red first discipline that produced the existing false verdict catalogue.

### Refused, explicitly, for at least twelve months

- Any new transform or `TransformId`. Any recipe corpus.
- A Django deprecation detector product. `-W error::DeprecationWarning` and `django-upgrade` are free and first party.
- Test generation. Diffblue has roughly 46 million dollars, a Testing Agent GA since 24 March 2026 benchmarked at 81 percent line coverage versus 32 percent for a senior developer with an AI agent, and a Moderne partnership since 13 May 2025.
- Java, .NET, COBOL adapters.
- Multi repo campaign orchestration. Moderne, Sourcegraph and AWS have all converged there.
- Semantic or formal equivalence checking. Loop bounded, language specific, and the newest scalable result is C only.
- Production traffic replay. Speedscale and Keploy own it and it needs a running service.
- Failure partitioning in the frozen oracle. That is the recipe corpus in disguise.
- Multi file transform emission, which would require changing locked `FileChange`.
- A certification seal or signed attestation as authority. Cryptographic signing is not authority; the Vanta analogue works because an accredited external auditor signs.
- Any CRA compliance claim. CRA asks about vulnerable components and exploited vulnerability reporting, not behaviour preservation. The 11 September 2026 reporting date is real; the bridge to Refactron's artifact is not.
- Per migration pricing.
- A fleet dashboard or hosted control plane before there are users.
- Dependabot and Renovate bot PR verification **as currently imagined**. It is an attractive recurring wedge and it does not work on this engine: a lockfile only diff has zero `.py` edits, so `verify-diff.ts:93-100` returns UNPROVEN unconditionally, forever. Serving it honestly needs dependency path attribution (which of my tests execute code paths through the bumped package), which is a new subsystem, not a port. Name it as a future option, do not schedule it, and never present it as the fallback if the Django measurement fails.

---

## 6. Value capture, without papering over it

Three assurance products that failed to escape feature status, and why.

Codecov is the closest structural analogue: coverage attribution turned into a signal. Acquired by Sentry in December 2022, ARR never disclosed under either owner, priced at 29 dollars a month for five seats, sold on to Harness on 2 June 2026. Grit.io raised 7 million dollars from Founders Fund on "code migrations and dependency upgrades on autopilot" and was acquired by Honeycomb on 10 April 2025 and sunset.

Three things separated the survivors. Vanta reached 300 million dollars ARR by April 2026 across 16,000 customers at a reported median around 20,000 dollars, because an external auditor and the customer's procurement both demand the artifact. Semgrep prices per contributor, Sonar per line of code, Chainguard on engineering org size: all indexed to something permanent, none to an event. And each sells to whoever carries the risk.

**Refactron currently satisfies none of the three.** Say it that plainly.

1. **Nobody outside the engineering team demands a behaviour preservation artifact.** There is no auditor, no regulator, no counterparty. CRA does not ask for one. This is the single biggest reason Refactron may remain a feature, and no roadmap item in this document fixes it.
2. **There is nothing to price yet.** 1,011 npm downloads over three months, median one a day, 38 of 95 days at exactly zero. 110 PyPI downloads last month.
3. **The buyer identified by both prior stances is wrong.** A boutique consultancy on a fixed price migration contract wants a green artifact that releases final payment. Refactron's core property is refusing to be green. A report saying "43 percent of this migration is unproven" arms their client to withhold money. Selling refusal to the party whose margin depends on the absence of refusal is backwards. It is also unclear from the research that a Django focused fixed price upgrade consultancy segment of meaningful size exists at all: every consultancy datapoint available is Rails, Java or .NET.

The party who genuinely wants a refusal shaped verdict is **whoever must merge a change they did not write.** That is an engineering lead with a tooling budget, not a compliance officer and not a vendor. It is also, increasingly, everyone.

### The feature or company test, and it is about frequency not revenue

Do not measure this in dollars for the first year. Measure it in **how often the same repository is verified.**

- If Refactron is invoked once per migration, it is a feature. Migrations end, the meter stops, there is no renewal, and per migration is the worst revenue shape available.
- If Refactron is invoked on every machine authored PR, it may be a company, because the meter never stops and the pricing can index to repositories under continuous verification.

Migration is therefore a **workload, not a product line.** It is the demo that gets Refactron into the pull request loop, because it is the change large enough and mechanical enough that no reviewer pretends to have read it. If usage stays bursty and migration shaped after six months, the honest conclusion is that this is a feature and section 11 applies.

**If it survives:** price per repository under continuous verification, annual subscription, never per migration and never per scan. Codemod.com's Team plan at 1,000 dollars a month is the only public price point in the adjacent category and is a reasonable ceiling for a non enterprise tool here. Do not model revenue before the frequency question is answered.

**On the false SAFE corpus, and pick one.** CHANGELOG 0.3.0 lists roughly fifteen named false verdict classes with the repro that found each: a deleted file verifying SAFE, a blank line change vouching for an uncalled function found via a real `black` reformat of pydantic, a CRLF false SAFE, a healed flake false SAFE, a pip installed shadow bypass, an imports gate false UNSAFE on pallets/click. Publishing it converts a private test corpus into a public conformance checklist a funded competitor implements in a sprint. **Publish it anyway, and stop calling it a moat.** It is the best marketing asset available and it is category creation: no incumbent will publish a false SAFE rate because their sold metric is completion and a rigorous verifier makes that number worse. But the acquisition thesis that rested on the corpus being uncloneable should be withdrawn with it.

---

## 7. Competition, four honest answers

**Moderne and OpenRewrite.** 30 million dollar Series B in February 2025, 7,200 deterministic recipes, a Lossless Semantic Tree with full type attribution, Fortune 500 logos, and Python in the LST since 19 February 2026 aimed explicitly at upgrading Python runtimes and modernizing deprecated APIs across many repositories. *Effect on this plan:* it makes any recipe race unwinnable and it is moving into Python, so assume six to twelve months of clear air, not a moat. *Honest answer:* never compete on recipes, grade their output. Their entire agent safety story is determinism, with no test execution claim anywhere in their agent positioning. That gap is real. But be precise about why it persists: it is an asymmetry of **incentive**, not capability. Refusal lowers completion rate, which is the metric they sell. Incentives can change, and if Moderne ships an UNPROVEN state and a published false SAFE rate, section 11 applies.

**AWS Transform.** Runs the repo's existing tests in both source and target versions, iterates on failures with a generative fix loop, and has had no charge since 10 June 2026. *Effect:* it sets the price of test execution at zero and proves the "verifier defines done" architecture is already incumbent. *Honest answer:* Refactron cannot sell "we run your tests." It can only sell "we run them, and we refuse." A transformer that grades its own output is a fix loop, not evidence. Also honest: most buyers will be satisfied by a self graded loop, and for those buyers Refactron has nothing.

**GitHub Copilot app modernization.** GA for Java and .NET since 22 September 2025, inside a Copilot seat enterprises already own, and Microsoft's own documentation lists "Migrates existing and generates new unit tests to validate modernization outcomes." *Effect:* the generic verifier slot is closed and bundled at effectively zero marginal price. *Honest answer:* it is Java and .NET only today, which is not Refactron's language reach, so stay out of that room entirely. And note the citable point: generating new tests to validate the migration is the tautology at maximum strength, new tests against new code, with no oracle predating anything.

**Frontier coding agents.** MigrationBench 71.67 percent pass@1 minimal with a stock Claude 4.5 Sonnet loop, FreshBrew 52.3 percent with Gemini 2.5 Flash, no migration product involved. Anthropic's published playbook is "fix the loop, not the code": parity harnesses, phase gates, adversarial reviewer agents. *Effect:* simultaneously the largest threat and the only viable distribution channel. Sophisticated teams will build a bespoke harness and buy nothing. *Honest answer:* be the tool inside the loop, not the product beside it. MCP is the distribution surface: the handler is 41 lines, `verify_change` already exists unauthenticated, and `coverage_preflight` and `explain_verdict` were specced in June 2026 and never built. An agent that can ask what evidence it lacks before it writes the change is the highest leverage move available. Codemod.com survived by becoming the substrate an agent calls; Grit.io did not survive as a standalone codemod platform.

**Two boundary conditions.** Diffblue proves buyers pay to *manufacture* the oracle, not to grade against one, and that market is funded and taken. HeroDevs raised 288 million dollars selling the opposite of migration, so for any EOL trigger the cheapest compliant alternative may be a support subscription requiring zero engineering effort. Neither is a competitor for the agent diff loop, which is why the agent diff loop is the position.

---

## 8. The founder constraint

Solo founder plus agents, unfunded, in term time. Use this repository's own calibration data rather than optimism: twenty transforms shipped at roughly one day each with agent assistance, and one properly planned six week framework migration that shipped zero rewriting. The pattern is clear. **Well bounded, intra file, spec driven work goes fast. Cross cutting infrastructure and real world environment wrangling do not, and agents do not compress them.**

Marked by requirement:

**Solo executable:** everything in weeks 1 to 5, the narrow environment layer, frozen oracle v1 and v2, TypeScript coverage attestation, extended runner detection, MCP tools, all content and benchmark publication, and the five repo hand run measurement.

**Slips without a second pair of hands, mark as such and do not promise dates:** widening the environment layer past the reproducible path (poetry, Pipfile, conda, C extensions, older interpreters); change scoped test selection, which is genuinely needed since `verify-diff` runs the suite up to four times per verification under a flat 600,000 ms cap in `runners/detect.ts` and CTFd with 661 tests timed out at 1800 seconds in this repo's own corpus run, but which also cannot be built soundly on a call graph that resolves callees to bare identifier names and an import graph that drops every third party edge.

**Requires a hire:** any second language family (Java, .NET), a hosted CI service with an SLA, and any sales motion beyond hand run conversations.

**Requires funding:** enterprise motion, a Gartner shortlist entry, SI channel, or competing on recipe breadth. None of these should be attempted in 2026 or 2027.

**The 90 day plan below assumes roughly one focused design day per week plus agent executed implementation.** If actual capacity is higher, pull the month 4 to 6 items forward. Do not add items to compensate for a good week.

---

## 9. Risks, ranked, with leading indicators

**1. The frozen oracle floor comes back near zero on real migrations.** This is the G0 pattern repeating in a new costume, and G0 returned 0 of 227 twice. *Leading indicator:* on the first two hand run repos, more than 40 percent of base test files fail to collect against the migrated tree. That means module path drift dominates and the floor is structurally low regardless of coverage quality. *Response:* stop at week 12, keep the frozen oracle for same version agent diffs, drop migration from the positioning.

**2. A frontier lab or GitHub ships a refusal shaped gate first party.** This ends the independent verifier thesis in a quarter. *Leading indicator:* any first party agent surface exposing an "evidence missing" state, a coverage attributed verdict, or a published false SAFE rate in changelog notes. *Response:* section 11.

**3. Hardening the doctrine makes the product useless.** Ratio gated SAFE plus the test file disqualifier will push nearly everything to UNPROVEN. A verdict that is always "I do not know" gets ignored, and this risk is created by the plan itself. *Leading indicator:* SAFE rate on real diffs below roughly 10 percent, and users passing flags to bypass the gate. *Response:* this is precisely why the frozen oracle floor is load bearing. Replace a binary verdict with a quantity. If the quantity is also uninformative, the doctrine has outrun the usefulness and the product has no shape.

**4. Nobody uses it, because awareness rather than friction is the binding constraint.** *Leading indicator:* 90 days after removing the auth gate and publishing the false SAFE corpus, weekly npm downloads still under a few dozen from distinct sources. *Response:* the MCP surface is the only channel that scales without a marketing budget. If agent side invocation does not grow, no engineering fixes it.

**5. The environment layer's supported path is too narrow to matter.** *Leading indicator:* of the first ten repositories tried, fewer than four produce a reproducible environment. *Response:* one round of widening, then accept that version bumps stay out of reach and keep only region A and agent diff verification.

**6. It is a feature.** *Leading indicator:* usage is bursty and per migration, and no repository is verified twice in the same month. *Response:* section 11.

---

## 10. Ninety days, then twelve months

### Ninety days, 4 August to 2 November 2026

| Window | Deliverable | Done means |
|---|---|---|
| Weeks 1 to 2 | Ratio gated SAFE. `testFilesChanged` as a verdict input. Create and delete in diff intake, renames modelled as delete plus create with degraded coverage. Auth gate removed from `verify-diff` and `preflight`. Runner detection extended to `manage.py test`, tox, nox, uv, poetry. | The doctrine holds at migration diff sizes. A stranger runs `verify-diff` on a Django repo with no account. |
| Weeks 3 to 5 | Frozen oracle v1: base tests, head source, host dependencies. Additive `frozenOracle` fields on `VerdictReport`. `explain_verdict` MCP tool. | On a same version agent diff that rewrites source and tests, Refactron returns a preserved behaviour floor instead of a bare UNPROVEN. |
| Weeks 4 to 6 | Publish the false SAFE corpus: fifteen classes, repro for each, fix for each, and the measured current behaviour. Positioned as category creation, not as a moat. | One public document nobody in this market can answer without admitting they never measured. |
| Weeks 6 to 10 | Environment layer, narrow path only. uv and npm ci, lockfile hash cache, dual environment baseline, `environment-not-reproducible` refusal. Coverage file classification rule with its own red first tests. | A diff touching `requirements.txt` produces a verdict about an execution that actually corresponds to the post migration state, or a named refusal. |
| Weeks 10 to 12 | Frozen oracle v2 under head dependencies. The five repo Django 4.2 to 5.2 measurement, thresholds written down first, published either way. | One number, published. This gates everything after it. |

**Explicit non goals for these 90 days:** no revenue target, no paying customers, no dashboard, no Django detector, no new transform, no corpus larger than five repos. The success metric is **ten repositories verified by someone who is not the founder, at least three of them more than once.**

### Twelve month shape

**Months 4 to 6.** TypeScript coverage attestation from Istanbul `statementMap`, with the mandatory source map disagreement rule. This is when Node, React and Vue stop capping at UNPROVEN and it roughly doubles the addressable repository count without adding a language adapter. Angular becomes discussable, not before.

**Months 6 to 9.** Whichever branch the week 12 measurement selected. If the floor held, a multi step verdict ledger so a Django hop chain through 5.0 and 5.1 produces per step verdicts with legal intermediate red instead of one useless aggregate. If it did not, drop migration positioning and go all in on the agent PR loop.

**Months 9 to 12.** Answer the frequency question with data and decide whether to price. If repositories are being verified weekly, introduce a per repository subscription and find the first ten buyers by hand. If they are not, stop building and read section 11.

**Where this plausibly ends up in August 2027.** Refactron is the independent gate that agents and transformers call to have work they produced graded by a party that did not produce it, in Python and TypeScript, with the only published false SAFE methodology in the market and the only preserved behaviour floor. Whether that is a company or an absorbed capability is genuinely open, and the plan is arranged so the answer costs one measurement in week 12 and one frequency reading in month 9 rather than a year of building.

---

## 11. What would make me abandon this

Written now, so it can be executed later without renegotiation.

1. **The week 12 measurement returns a median floor below 25 percent with collection failure at or above 40 percent.** The frozen oracle does not survive framework majors. Delete the migration positioning entirely, keep the primitive for same version agent diffs, and never mention migrations in marketing again.
2. **Any first party agent vendor or migration platform ships a refusal state with a reason string, or publishes a false SAFE rate.** The seat is taken by someone with distribution. The remaining value is the false SAFE corpus and the statement attribution work; publish everything, and seek absorption or archive.
3. **Six months after the auth gate removal, the corpus publication and the frozen oracle, no repository has been verified twice by a non founder.** It is a feature. Stop building, open source fully, and approach the parties for whom it is an obvious gap: Moderne, Sourcegraph, or a CI vendor. Absorption is the modal outcome in this category and it is only a bad one if it arrives as a surprise.
4. **The environment layer's supported path covers under 30 percent of tried repositories after two rounds of widening.** Version bumps are permanently out of reach for a solo founder. Drop that pillar, keep region A and agent diffs, and shrink the claim to match.
5. **Ratio gated SAFE plus the test file disqualifier drive the SAFE rate on real diffs below 10 percent and the floor number turns out to be uninformative too.** Then the doctrine has consumed the product. That is the one failure mode that cannot be fixed by changing buyer, language or wedge, because it means honest verification of machine authored change has no useful output. Publish the finding. It would be a genuinely valuable negative result and it is worth more than a pivot.

---

## Appendix: claims used with caution, and claims not used

**Flagged UNVERIFIED in the research and therefore not built on:** Python 3.10 and 3.11 EOL dates (python.org devguide returned 429); the Astral to OpenAI, Grit and OpenRewrite absorption claims taken from an internal document; "43 percent of new outsourcing deals are outcome based," single secondary source, and it referred to enterprise outsourcing rather than boutique shops; HeroDevs pricing of 25,000 to 75,000 dollars a year, from a third party rather than HeroDevs; Blitzy per line pricing, blocked source; the Deloitte technical debt share of IT spend; Vue 2 domain counts; Sonar's valuation and headcount; Semgrep ARR; Cognition public pricing tiers.

**Verified against the working tree before writing:** `shadow-tree.ts:26` symlinks `node_modules`, `.venv` and `venv`. `verify-diff.ts:93-100` bails to unknown coverage when any edit is non Python. `verdict-fuse.ts:53-56` documents `testFilesChanged` as a note and not a verdict input. `coverage-attribution.ts:106-109` computes `changedStatements` and states it does not feed the verdict rule; lines 215-220 confirm the per file "at least one statement" SAFE heuristic. `diff-input.ts:237-260` refuses deletions, copies, renames and submodule pointer changes. `runners/detect.ts` knows exactly vitest, jest and pytest with a 600,000 ms default timeout. `contracts.ts` carries exactly 20 `TransformId` literals with no SQLAlchemy or Django entry. `requireAuth` wraps `analyze`, `run`, `init`, `document`, `preflight` and `verify-diff`.

**Deliberately not asserted anywhere in this document:** that Django applications reliably ship runnable suites; that a reachable segment of Django focused fixed price upgrade consultancies exists; that CRA creates demand for a behaviour preservation artifact; that the false SAFE corpus is uncloneable; that any competitor lacks the capability to refuse, as opposed to lacking the incentive.