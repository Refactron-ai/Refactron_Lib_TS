# Refactron — Phase 2 Roadmap & Monetization

**Date:** 2026-07-06
**Context:** Phase 1 (`preflight` verification artifact) shipped in PR #74. G0-on-apps closed inconclusive → auto-rewriter out of scope, verification/preflight is the product. Phase 2 = the fundable wedge: "verify your AI agent's change before it lands." Keystone spike (2026-07-04) proved arbitrary-diff verification is a small lift (the engine is already author-agnostic).

Grounds/extends the strategy spec `docs/superpowers/specs/2026-06-26-refactron-verification-trust-layer-strategy.md` (§5/§7/§8) with the concrete Spec-by-Spec decomposition.

---

## Phase 2 — the execution roadmap (Spec by Spec)

Decomposed so each spec is a tight, independently shippable unit. Ordered by dependency: **demo → org adoption → usable at scale → broaden → monetize.**

| Spec | What | Why it's here / gates on | Product tier |
|---|---|---|---|
| **Spec 1** | `verifyDiff` core + **MCP `verify_change`** (Mode A: verify a *proposed* change before it lands) | The **demo** — "agent verifies its own diff, gets SAFE/UNSAFE/UNPROVEN back." Keystone proven feasible. | Free/OSS |
| **Spec 2** | **CI gate** — GitHub Action / `refactron verify --ci`; posts the verdict as a PR check (red on UNSAFE, warning + missing-coverage on UNPROVEN). Mode A, base = PR merge-base. | Second distribution channel; **org-level** adoption. CI-retention is the metric investors want. | Free/OSS |
| **Spec 3** | **Change-scoped test selection** — reintroduce blast-radius test selection (legacy engine had it; v2 dropped it for whole-suite-twice). | The **scale unlock**. Without it verifyDiff is demo-only; with it, fast on real repos. Biggest engineering investment after the demo. | Free/OSS |
| **Spec 4** | **Mode B + drift hardening** — verify an *already-landed* agent commit (reconstruct base from git); enforce base-SHA precondition (TOCTOU safety). | Broadens "wherever the change happens." | Free/OSS |
| **Spec 5** | **Fleet / dashboard / audit layer** — multi-repo verdict history, signed audit-grade report, aggregated "tests to add" backlog, org analytics. | **The paid surface** — where money enters. | Team / Enterprise |
| **Phase 3** | Regulated/audit-grade depth + language reach (Java). | Funded only. Highest willingness-to-pay. | Enterprise |

**Sequencing logic:** Specs 1–4 are the free/OSS product that drives adoption; Spec 5 monetizes the fleet; Phase 3 scales with capital. Maps to strategy Phase 2 → Phase 3.

---

## Monetization

**The boundary:** verifying *one change* is free; *managing trust across a fleet, over time, with an auditable record* is paid. (codemod's proven OSS-core + paid-platform shape, applied where they're weak: correctness guarantee + deep Python.)

| Tier | Who | What | Price hypothesis |
|---|---|---|---|
| **Free / OSS** | Individual devs, OSS | CLI, MCP server, single-repo CI gate, verdict reports, migration mode | **$0 forever** — the wedge; devs won't pay to try, MCP/CI need zero friction to spread |
| **Team** | 10–200-eng teams | Fleet verification, verdict history + dashboards, flakiness analytics, aggregated missing-coverage backlog, priority support | **~$1–2k/mo** (anchored to codemod's Team tier) |
| **Enterprise** | Regulated / large orgs | Signed audit-grade reports, on-prem/BYOC, SSO/RBAC/SOC2, dedicated support | **Custom, annual** — the real money |

**Why it pays:** as AI writes more of the code, human review becomes the bottleneck and the liability. Teams pay to land more agent-generated change with *less* review + a defensible audit trail. The **MCP tool drives usage** (every agent PR = a verification); the **fleet/audit layer is what they pay for** once verification is load-bearing. In regulated industries "the AI thinks it's fine" is legally insufficient — a reproducible behavior-preservation record becomes a procurement requirement (Enterprise money).

**Open pricing question (decide on design-partner data, not now):** seat-based vs. **usage-based** (per-verification / per-repo). Usage-based aligns with the growth curve (more agent PRs → more verifications → more value → more revenue) — lean that way, confirm with early-access partners.

**Near-term reality:** for a pre-seed company the metric isn't ARR yet — it's **design partners** on the early-access list who validate willingness-to-pay and become the raise's case studies. The website email capture is the top of that funnel. **Seed raise = the demo (Spec 1) + CI-gate retention (Spec 2) + a few paying-intent design partners.**
