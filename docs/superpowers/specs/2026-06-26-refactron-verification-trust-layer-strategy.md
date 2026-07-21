# Refactron Strategy: The Verification/Trust Layer for Code Change

**Status:** Design / strategy spec — approved shape, pending founder review
**Date:** 2026-06-26
**Author:** Om Sherikar (with research synthesis)
**Decision owner:** Om Sherikar
**Supersedes (in spirit):** the v2.1+ breadth roadmap (`dev-docs/Refactron v2.1+ Roadmap.md`); extends the SQLAlchemy wedge plan (`docs/plans/2026-06-18-v0.3.0-sqlalchemy-migration.md`)

> **The one-line bet.** As AI writes a rapidly growing share of production code, the bottleneck moves from _generating_ changes to _trusting_ them. Refactron stops being "another deterministic refactoring tool" and becomes **the verification layer that proves a code change — yours, a codemod's, or an AI agent's — preserved behavior, with reproducible, audit-grade evidence.** We expose it where the change happens: an MCP server agents call, and a CI gate that blocks unsafe landings.

---

## 0. How to read this doc

This is a strategy spec, not an implementation plan. It locks **direction, sequencing, GTM, monetization, and kill-criteria**. The implementation plan (Phase 1 build) is the follow-on artifact via the writing-plans flow.

Two founder decisions are already locked (2026-06-26):

- **Ambition:** VC-fundable startup (real revenue + a raise), not an indie/lifestyle or pure-portfolio project.
- **Identity:** Reposition _fully_ around verification/trust; expose via MCP/CI so AI agents call it; transforms become demos of the gate, not the point.

Everything below is built on those two answers.

---

## 1. Diagnosis — why reposition (the evidence, condensed)

Four research streams (internal docs + evok.dev + codemod.com + the broader landscape/market) converged on five facts that kill the status quo and one that creates the opening. Confidence flagged; full sourcing in the research briefs.

1. **"Run tests, land only if green" is no longer a moat.** GitHub Copilot app-modernization (GA Sept 2025) "executes OpenRewrite to apply transformations, dynamically resolves build issues, and runs test validations" — it already fuses deterministic-engine + test-gate. AWS Transform, OpenAI Codex (validate-repair loop), Devin, and Claude Code all run tests-in-a-loop. **(HIGH)** The one thing _nobody_ markets is autonomous land with no human review — they gate on a reviewed PR for liability reasons. **That gap is our wedge: the trustworthy gate, not the loop.**

2. **Commodity transforms are dead on arrival.** Refactron's own v2.1+ roadmap marks nearly every transform "coverage: Complete (pyupgrade / Ruff / ESLint)." Ruff (now **owned by OpenAI**, Mar 2026), ts-morph, jscodeshift do these for free. Per-seat WTP for deterministic Python/TS transforms ≈ 0. **(HIGH)**

3. **Language scope is inverted vs. the money.** Modernization _budget_ is in Java/COBOL/.NET/SAP (~$22B+ services market, 15–20% CAGR). Python/TS is the smallest budget _and_ the zone where free AI agents are strongest. **(HIGH on budget; the conclusion follows.)**

4. **The deterministic category is being absorbed by AI platforms as a _substrate_, not winning standalone.** Astral/Ruff→OpenAI (Mar 2026); Grit→Honeycomb (Apr 2025, GritQL handed to Biome); OpenRewrite runs _inside_ Copilot/Amazon Q. Determinism wins as the thing agents call. **(HIGH)**

5. **evok.dev is a manifesto, not a competitor (yet).** Pre-launch, anonymous, no funding signal, JS/TS-only with Python ingestion "in development," and — critically — **no test-verification story** (safety = "our math twin says so"). We borrow their _framing_ ("LLMs are a probabilistic solution to a deterministic problem"), not their product. They have nothing we don't. **(HIGH)**

**The opening (the one fact in our favor):** codemod.com — the closest funded analog ($1k/mo Team tier, OSS+registry+platform, React/Node framework partnerships) — has **no correctness guarantee** (safety = "review the diff"; their own data: ~25% of AI-codemods wrong, 18% silently) and **near-zero Python depth.** That is precisely the white-space. The durable, hard-to-copy asset Refactron already owns — blast-radius-gated test selection + shadow-tree run + atomic land + audit trail — is **the half AI agents are worst at and most want to outsource.** Investors are explicitly funding "auditable agents." Gartner warns >70% of 2026 mainframe-exit projects will fail by over-trusting GenAI — a buy-signal for a trustworthy gate.

**Conclusion:** Keeping the commodity-transform path = competing in the smallest-budget, most AI-exposed niche. The move is to **make verification the product** and sell it _to_ the wave instead of _against_ it.

---

## 2. The repositioning

### 2.1 Positioning statement

> **Refactron is the verification layer for code change.** It proves — by running your real test suite, blast-radius-scoped, in an isolated shadow tree, and landing atomically only on green — that a change preserved behavior, and produces a reproducible, audit-grade record of _why it's safe_. It plugs in wherever change happens: as an MCP server your AI agent calls before it lands, and as a CI gate that blocks unsafe merges.

**Category we are creating/claiming:** _AI code-change verification_ (a.k.a. the "trust layer for agentic code"). Not a linter, not a codemod runner, not an AI assistant. The thing that answers **"did this change actually break anything, and can you prove it?"**

### 2.2 Ideal customer profile (sequenced)

- **Wedge ICP (Phase 1–2):** engineering teams (10–200 eng) already using AI coding agents (Cursor/Claude Code/Copilot/Codex) or running large migrations, who are **nervous about what the agent merged** and have a test suite they don't fully trust. Python-heavy shops first (our depth + competitors' gap).
- **Scale ICP (Phase 3):** platform/DevEx and compliance orgs in regulated industries (fintech, health, gov) where "the AI thinks it's fine" is legally insufficient and an auditable behavior-preservation record is a procurement requirement.

### 2.3 What changes vs. what we keep

| Keep (the crown jewels)                                                                            | Retire / demote                                                        | Add (the reposition)                                                  |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Verification engine: blast-radius gating, shadow-tree test run, atomic write/rollback, audit trail | The v2.1+ breadth roadmap (37 commodity transforms) — formally shelved | **MCP server** ("verify this change before I land it")                |
| Coverage/flakiness pre-flight (the G0 instrument) — now a _headline feature_                       | "No-LLM purity" as identity — we become the thing LLMs _call_          | **CI gate** (GitHub Action / CLI) that blocks unsafe merges           |
| Python (LibCST) + TS (ts-morph) depth                                                              | "Refactoring tool" as the category                                     | **Verification report / audit artifact** (signed, reproducible)       |
| SQLAlchemy 1→2 migration work                                                                      | —                                                                      | **Agent-change verification mode** (verify a _diff we didn't author_) |

**Critical architectural unlock:** today verification only runs on transforms _Refactron authored_. The reposition requires verifying an **arbitrary diff** (an agent's, a codemod's, a human's). That is the central new capability — see §4.

---

## 3. PMF thesis

### 3.1 The value hypothesis

_As agents generate more changes, human review becomes the bottleneck and the liability. Teams will pay for a system that converts "the agent says it's fine" into "here is reproducible proof it's fine," so they can land more agent-generated change with less human review and a defensible audit trail._

### 3.2 Why now (timing)

- Agent-generated PRs are exploding but **auto-land is universally gated on human review** — vendors won't take the liability. Verification is the missing primitive that makes higher autonomy safe.
- MCP is the emerging standard for "tools agents call" — distribution channel exists _now_ (codemod already ships an MCP server; Cursor/Claude Code/Codex/Goose support it).
- "Auditable agents with oversight" is an explicitly stated 2026 investor thesis.

### 3.3 The wedge (why we win the first beachhead)

High-stakes migrations (SQLAlchemy 1→2, Pydantic v1→v2) are the cases where the test-gate _is_ the entire value: the failure mode is **silent wrong behavior in production, not a compile error** — exactly where agents are scary and where "review the diff" (codemod) and "our twin says so" (evok) both fail. Winning here is the proof that the verification layer is real.

### 3.4 PMF leading indicators (how we'll know)

- **Activation:** % of installs that run the gate on a real change within 7 days.
- **Core engagement:** # of agent-generated PRs run through the gate / week; % of CI pipelines that _keep_ the gate after 30 days (retention is the truth signal).
- **Pull:** inbound from agent-tool / framework communities; "verify your AI's PR" search/share signal.
- **Willingness-to-pay:** conversion to a paid tier on fleet/audit features; ≥1 framework-partnership LOI.
- **Kill signal:** if teams install the gate and _remove_ it within 2 weeks (verification not worth the latency/noise), the value hypothesis is wrong — see §10.

---

## 4. Product architecture of the reposition

We are not rebuilding; we are re-pointing the engine at a new input and wrapping it in two distribution surfaces. Preserve the three invariants (atomic writes, blast-radius-gated verification, locked adapter boundary).

### 4.1 The core capability shift: "verify an arbitrary diff"

```
Input: a diff (agent/codemod/human) + repo state
  → parse & map changed symbols (LibCST / ts-morph adapters — already have these)
  → blast-radius analysis (import graph + call graph — already have these)
  → coverage/flakiness pre-flight on the affected subset (the G0 instrument, promoted)
  → shadow-tree apply + scoped test run (verification engine — already have this)
  → verdict: SAFE (green, covered) | UNSAFE (red) | UNPROVEN (green but uncovered)
  → atomic land OR block, + signed verification report
```

The **UNPROVEN verdict is the product's intellectual honesty and its moat**: unlike "tests pass" hand-waving, we explicitly say "tests pass _but the changed code isn't exercised, so this is unproven_" — and tell you which tests to add. This is the trust differentiator no competitor offers.

### 4.2 Distribution surfaces

1. **MCP server** — tools: `verify_change`, `coverage_preflight`, `explain_verdict`. An agent proposes a diff → calls `verify_change` → gets SAFE/UNSAFE/UNPROVEN + the report → decides whether to land. This is how we become the thing agents call (answers the "routed around in 18–24 months" risk by _being the route_).
2. **CI gate** — GitHub Action / CLI (`refactron verify`) that runs on PRs, posts the verification report as a check, blocks merge on UNSAFE, surfaces UNPROVEN as a warning with the missing-coverage list.
3. **Migration mode (the beachhead)** — `refactron migrate sqlalchemy` etc.: we author _and_ verify, as the demo that proves the gate on the scariest changes.

### 4.3 Build order (what's new vs. reused)

- **Reuse as-is:** adapters, import/call graph, shadow-tree runner, atomic writer, blast-radius scorer.
- **Promote to headline:** coverage/flakiness pre-flight (was the internal G0 gate).
- **Build new:** arbitrary-diff ingestion + symbol mapping; the SAFE/UNSAFE/UNPROVEN verdict + signed report; MCP server; CI gate / GitHub Action.

---

## 5. The sequenced roadmap

### Phase 1 — Beachhead: prove the gate where AI is scary (now → ~3 months)

**Goal:** an undeniable, demoable artifact: "Refactron safely did the SQLAlchemy 1→2 migration that teams are afraid to let an agent touch — and proved it."

- **Step 0 (gating, non-negotiable): run Gate G0.** Do real SQLAlchemy 1.x codebases (target the corpus already named: flask-appbuilder, sqlalchemy-utils) have ≥50% test coverage on the rewrite subset? Fix the `Model.query` detector blind spot first. **If G0 fails, we ship flag-only / pick a different migration — do not proceed to build the migration as if coverage exists.** (This de-risks the existential premise before we spend the quarter.)
- Ship `refactron migrate sqlalchemy` with the coverage pre-flight front-and-center (it tells the truth about what can/can't be safely migrated).
- Land the **UNPROVEN verdict** and the verification report as the signature output.
- **Exit criteria:** G0 passed (or pivoted) + ≥3 real external repos migrated with verification reports + a public writeup/demo.

### Phase 2 — Reposition: the verification layer becomes the product (parallel from ~month 1, primary by ~month 3–6)

**Goal:** the fundable wedge — "verify your AI agent's change before it lands."

- Build **arbitrary-diff verification** (§4.1) — the core unlock.
- Ship the **MCP server** + the **CI gate / GitHub Action**.
- OSS the core (Apache-2.0, already there); stand up a thin paid tier scaffold.
- Pursue 1–2 **framework partnerships** (SQLAlchemy/Pydantic/Django maintainers) — the codemod growth lever, applied where codemod is weak.
- **Exit criteria:** verification gate live in ≥10 external CI pipelines; MCP server used by real agent workflows; PMF leading indicators (§3.4) trending; this is the seed-raise narrative.

### Phase 3 — Scale with capital (post-seed)

**Goal:** follow the money toward where verification commands a premium.

- Audit-grade reporting (signed, reproducible, compliance-framed) for regulated buyers.
- Broaden language reach toward the budget (Java/.NET) — **funded, never the solo opening move**; gated on enterprise pull.
- Fleet/multi-repo orchestration + dashboards (the paid platform).

---

## 6. Go-to-market

### 6.1 Motion

Bottoms-up, developer-led, complement-not-competitor. Land free (OSS CLI + MCP server + GitHub Action) → expand to paid on _fleet, audit, and dashboards_. We never fight Cursor/Copilot head-on; we make them safer.

### 6.2 The playbooks we steal (and from whom)

- **From codemod.com:** OSS core + paid orchestration boundary; **framework partnerships** as the growth flywheel (they co-maintain React's codemods / hold `@nodejs`). We do the same with **Python framework maintainers** (SQLAlchemy, Pydantic, Django, FastAPI) — where codemod has no presence. Also: **ship an MCP server + a persistent "skill"** so we're the tool agents call.
- **From evok.dev:** the crisp wedge narrative ("probabilistic solution to a deterministic problem"; AI as the commodity, the _understanding/verification_ layer as the durable asset) and the editorial brand polish. Borrow the story; ship the proof they lack.

### 6.3 Channels

- **MCP/agent ecosystems** (Cursor, Claude Code, Codex, Goose) — be in the registries; "verify before you land."
- **GitHub Marketplace** (the CI gate Action) — distribution + social proof via check runs on public PRs.
- **Content/credibility:** the SQLAlchemy migration writeup; a public, reproducible benchmark of "agent-generated change correctness, verified" (directly answering codemod's own ~25%-wrong data and evok's unfalsifiable claims). This is the HN/X-shaped artifact.
- **Framework-maintainer relationships** → official "verified migration" scopes.

### 6.4 Positioning vs. each competitor (the one-liners)

- vs. **codemod.com:** "They tell you to review the diff. We prove the diff is safe — and tell you when it _isn't provable_."
- vs. **evok.dev:** "Their twin says it's correct. Your own tests say it's correct — shipping today, Python and TS equally."
- vs. **agents (Cursor/Copilot/Devin):** "We don't replace your agent. We're the gate that lets you trust what it merged."

---

## 7. Monetization

OSS-core + paid-platform (codemod's validated shape, our differentiated value).

| Tier           | Who                           | What                                                                                                 | Price hypothesis                                                          |
| -------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Free / OSS** | Individual devs, OSS projects | CLI, MCP server, single-repo CI gate, verification reports, migration mode                           | $0 forever (the wedge + distribution)                                     |
| **Team**       | 10–200 eng teams              | Multi-repo fleet verification, audit-trail history/dashboards, flakiness analytics, priority support | ~$1–2k/mo entry (anchor to codemod's $1k Team), refine via Phase-2 pilots |
| **Enterprise** | Regulated / large orgs        | Signed audit-grade reports, on-prem/BYOC, SSO/RBAC/SOC2, compliance integrations, FDE                | Custom, annual                                                            |

**Monetization boundary:** the _verification of one change_ is free; _managing trust across a fleet, over time, with an auditable record_ is paid. The transform commoditizes; the trust layer does not.

**Open question to resolve in Phase 2 pilots:** seat-based vs. usage-based (per-verification / per-repo) pricing. Usage-based aligns with the agent-PR-volume growth curve; decide on real pilot data.

---

## 8. Scaling ladder & "up to what scale"

Honest scenarios, given a solo founder starting from a shipped v0.2.4.

- **Floor (must clear to be fundable):** Phase-2 traction — gate retained in ≥dozens of CI pipelines, real MCP usage, 1+ framework LOI. This is a **pre-seed/seed** story ($1–3M), comparable to early codemod (sub-$5M, undisclosed) and the "auditable agents" thesis.
- **Base case (venture path):** the verification layer for AI-generated code reaches **$10–50M ARR** as agent-PR volume compounds; Series A/B; valuation in the **$100–300M** range. Reference points: Moderne ($30M Series B, Feb 2025), Semgrep ($100M Series D, ~$500M–1B est.).
- **Upside / category win:** if "AI code-change verification" becomes a real category and we own the standard agents call, **$1B+** standalone is conceivable but is the tail, not the plan.
- **Most likely exit (and a legitimate goal you chose):** **strategic acquisition** by an AI-coding/devtools platform that needs a verification/trust layer and a Python-deep team — the exact pattern of Astral→OpenAI and Grit→Honeycomb. The reposition is deliberately shaped as one defensible, plug-in-able piece, which maximizes this optionality. Target band: **$50–300M** depending on traction.

**Realistic ceiling note:** we are a _slice_ of the ~$22B app-modernization services market plus the _nascent_ AI-code-governance category (no clean TAM yet — say so to investors; the pitch is "as AI writes more code, verifying it is the bottleneck, and we own that primitive"). Do not oversell a TAM number; sell the wedge + the wave.

---

## 9. Fundraising plan

- **Raise:** pre-seed/seed, **$1–3M**, after Phase-2 leading indicators (not before — the SQLAlchemy demo + early gate retention is the proof that earns terms).
- **Narrative:** "AI is writing the code; we verify it didn't break anything — the trust layer agents plug into. Here's it working on the migration everyone's afraid to automate, and here's the gate live in N pipelines."
- **Metrics investors will want:** gate retention in CI (the retention curve is the whole story), MCP/agent usage, # repos, conversion intent / paid pilots, framework partnership signal.
- **Comparable investors/thesis:** funds backing "auditable agents / oversight" and dev-infra (the Propeller/Vercel-accelerator-style early devtools investors that backed codemod; angels from Sourcegraph/Sentry/Dropbox orbit).
- **Founder note (real constraint):** you are a 2nd-year B.Tech student and solo. The fundable path likely needs (a) a co-founder or first hire by Phase 2, and (b) the demo to do the talking. Build the proof; let it recruit capital and people. This is an explicit risk (§10).

---

## 10. Risks & kill-criteria (named honestly)

| Risk                                              | Why it's real                                                                                             | Trigger / mitigation                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G0 fails — the test-coverage premise is false** | Legacy targets have thin/flaky tests; "tests pass" then proves nothing (your docs call this existential). | **Run G0 in Phase-1 Step 0.** If real SQLAlchemy corpora lack coverage on the rewrite subset → pivot migration target or lead with the coverage-preflight-as-product (knowing what's _unverifiable_ is itself valuable). Do not build the migration assuming coverage.                                    |
| **Agents subsume verification in-house**          | They run tests-in-a-loop already.                                                                         | Our wedge is the _trustworthy land/block + UNPROVEN honesty + audit record_ they deliberately avoid (liability). Ship as MCP/CI so we're a complement they adopt, not a feature they rush to clone. Watch for any vendor shipping a marketed "verified autonomous land."                                  |
| **Verification isn't worth the latency**          | A gate that's slow/noisy gets removed.                                                                    | PMF kill-signal: installs that remove the gate within 2 weeks. Mitigate with blast-radius-scoped (fast) runs and the UNPROVEN signal earning trust. If retention can't clear a bar by end of Phase 2, the standalone thesis is wrong → fall back to migration-platform (Approach B) or acqui-hire the IP. |
| **Python/TS WTP too thin**                        | Structural finding.                                                                                       | The reposition moves WTP from "transforms" (free) to "trust/audit at fleet scale" (paid) and toward regulated buyers in Phase 3. If Team-tier conversion stalls, accelerate the regulated/audit angle.                                                                                                    |
| **Solo-founder bandwidth**                        | Student, no team, fundable bar is high.                                                                   | Sequence forces one demoable artifact before anything else; recruit co-founder/capital off the proof.                                                                                                                                                                                                     |
| **evok.dev or a new entrant out-narrates us**     | They have the sharper story today.                                                                        | We ship proof they can't; re-rate immediately if evok names credible founders, raises, or ships a reproducible demo, or if any agent vendor announces "powered-by-verification."                                                                                                                          |

---

## 11. Decisions: locked vs. open

**Locked (do not relitigate):**

- Reposition fully around verification/trust; VC-fundable target; MCP + CI distribution.
- Verification engine + invariants (atomic write, blast-radius gating, locked adapter) are the durable asset and are preserved.
- The v2.1+ commodity-transform breadth roadmap is **shelved**.
- Sequencing: beachhead (SQLAlchemy, G0-gated) → reposition (verification MCP/CI) → scale (regulated/Java with capital).
- LLM stance evolves: from "no LLM in the path" to "we are the deterministic gate that LLM agents call." (Resolves the PRD-vs-research contradiction in our own docs.)

**Open (resolve with data, not debate):**

- Pricing model: seat vs. usage (Phase-2 pilots decide).
- Exact second framework wedge after SQLAlchemy (Pydantic v1→v2 vs. Django) — pick on partnership traction.
- Naming/brand: keep "Refactron" or sub-brand the verification product (e.g. "Refactron Verify"). Defer; not load-bearing pre-Phase-2.
- Co-founder/first-hire timing and profile.

---

## 12. Immediate next actions (next ~2 weeks)

1. **Run Gate G0** on the SQLAlchemy corpus (fix the `Model.query` detector blind spot first). Single biggest de-risking move; everything downstream depends on the result.
2. Draft the **arbitrary-diff verification** technical spike (can the engine verify a diff it didn't author?) — the Phase-2 core unlock; prove feasibility early.
3. Write the **public positioning** one-pager using the §6.4 one-liners (kills the "refactoring tool" framing internally and externally).
4. Formally shelve the v2.1+ breadth roadmap in the repo (a short ADR pointing here) so effort stops leaking into commodity transforms.

---

_This spec is the strategic spine. The Phase-1 implementation plan (G0 + SQLAlchemy migrate + coverage-preflight-as-feature) is the next artifact, produced via the writing-plans flow once this is approved._
