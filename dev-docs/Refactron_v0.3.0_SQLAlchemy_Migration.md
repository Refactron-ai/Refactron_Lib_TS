# Refactron — SQLAlchemy 1.x → 2.0 Migration: Phase-Wise Build Plan

**What this is:** the build-ready execution plan for Refactron's first real product wedge, the SQLAlchemy 1.x to 2.0 migration. This is the thing that turns the verification engine from a claim into a product.

**Why this migration:** it is the cleanest unsolved migration in the Python ecosystem. SQLAlchemy ships only runtime deprecation warnings (`SQLALCHEMY_WARN_20=1`), not a rewriter. There is no first-party codemod and no trusted third-party rewrite tool. The failure mode is silent wrong query results in production, not a compile error, which is exactly the case where a full-test-suite verification gate is the only reliable safety net. (Pydantic and React already have official codemods; that is why this, not those.)

**The one-line positioning:** "The SQLAlchemy 2.0 migration that has no codemod, done safely. Deterministic rewrites where we can prove them, precise flags where we can't, and your full test suite runs before a single line is written. No LLM touches your code."

---

## 0. The two hard truths this plan is built around

Both come straight from the validation research. Ignore either and the product is theater.

**Truth 1 — The wedge must have a visible path to a platform.** A single-migration CLI is a feature, not a company. The one venture-scale pure-play in this exact space (Moderne/OpenRewrite) had to broaden from "migrations" to an org-wide platform to be fundable. So SQLAlchemy is built as the *first* migration on a reusable engine, not as a one-off script. Every primitive built here (the rewrite engine, the flag/diagnostic system, the coverage pre-flight, the verification gate) must be migration-agnostic so Pydantic, Django, and CommonJS→ESM slot in later with no rework.

**Truth 2 — The verification moat is only as good as the user's tests, and that is a first-class product problem, not a disclaimer.** Legacy SQLAlchemy 1.x codebases are old; old codebases frequently have thin, flaky, or DB-dependent test suites. If the tests don't exercise the queries being rewritten, "tests pass" proves nothing (false confidence), and flaky tests cause false rejections that destroy the trust the product exists to win. So this plan ships a **coverage-and-flakiness pre-flight as part of the product**, not as an afterthought. The product tells the user how much it can actually prove, honestly, before it touches anything.

---

## 1. Scope

**One transform family: `sqlalchemy_query_to_select`**, shipped in two halves that are equally first-class:

**A. Deterministic rewrite (the safe subset):**
```python
session.query(Model)                 → select(Model)  (wrapped in session.execute(...))
.filter(cond)                        → .where(cond)
.filter_by(name="x")                 → .where(Model.name == "x")
session.query(Model).get(id)         → session.get(Model, id)
.all() / .first() / .one()           → .scalars().all() / .scalars().first() / .scalars().one()
.count()  (simple shape only)        → select(func.count()).select_from(Model)
```

**B. Detect-and-flag (the unsafe subset — diagnose, never rewrite):**
- `lazy="dynamic"` relationships (still Query-based in 2.0, API in flux)
- complex / chained / self-referential joins, `Query.select_entity_from()`
- bulk `update()` / `delete()` (semantics changed materially in 2.0)
- `Row` / `LegacyRow` tuple-vs-mapping access
- implicit autocommit / connection-vs-session execution patterns
- subquery and `aliased()` constructs beyond the trivial case
- multi-entity / column-only selects where `.scalars()` would be wrong
- multi-statement query assembly (conditional `.filter()` appends across lines)

The flag half is shipped in the same release and is arguably the bigger first-value: it hands a scared team a precise, reasoned inventory of "safe to auto-migrate / must do by hand, and exactly why."

**Out of scope for this wedge (roadmap, not now):** Core-style `engine.execute()` migration, Alembic scripts, async `AsyncSession` specifics, the further `Query` removal in 2.1+.

---

## 2. The reusable engine (build migration-agnostic from day one)

These components must NOT be SQLAlchemy-specific. SQLAlchemy is their first consumer.

| Component | What it does | Reused by future migrations |
|---|---|---|
| `Detector` interface | walks a codebase, classifies sites as rewrite / flag / ignore | every migration |
| `Rewriter` interface | applies a deterministic LibCST transform to a safe-subset site | every migration |
| `FlagRecord` | structured precondition record explaining a refusal | every migration |
| `CoveragePreflight` | reports test coverage + flakiness for the sites about to change | every migration |
| `VerificationGate` | syntax + imports + full test suite on a shadow copy; atomic write or rollback | every migration |
| `MigrationManifest` | declares a migration's detectors, rewriters, flags, and version targets | every migration |

If SQLAlchemy is built as a `MigrationManifest` plugged into this engine, then Pydantic/Django later are new manifests, not new products. That is the wedge-to-platform path made concrete.

---

## 3. Phases & gates

Each phase ends with a binary gate. No phase starts until the prior gate passes.

### Phase 0 — Validate the premise (Week 1) — DO NOT SKIP

The research named the test-coverage dependency as the central risk. This phase tests it before you build the expensive rewrite logic.

**Build only:** the `Detector` + `CoveragePreflight`. No rewriting yet.
- Detector classifies every query site as rewrite-subset vs flag.
- CoveragePreflight reports, per rewrite-subset site, whether it has any test coverage, and runs the suite 3x to estimate flakiness.

**Critical detector fix first:** the existing detector only sees `session.query()` and misses the `Model.query.filter(...)` Flask-SQLAlchemy class-attribute idiom — likely the dominant tested pattern. Fix this before running any trial, or the coverage numbers are meaningless (the earlier "0/227 covered" result was an artifact of this blind spot).

**Run on:** 3–5 real SQLAlchemy 1.x codebases that have test suites, plus — most importantly — 1–2 actual prospective-user codebases if any are reachable.

**Gate G0 (the premise gate):** across these codebases, are the rewrite-subset queries actually covered by non-flaky tests?
- **Covered enough** → verification is meaningful here. Proceed to Phase 1.
- **Barely covered** → STOP. Do not ship a "verified" rewrite whose verification is theater. Pivot to: ship the detect-and-flag "migration planner" alone (still unique value, sidesteps the coverage problem), and/or pair migration with test-generation for the modules about to change.

### Phase 1 — Deterministic rewrite subset (Weeks 2–4)

- **Week 2:** `query()`→`select()` head + `.filter()`/`.filter_by()`→`.where()`, including the model-resolution machinery (resolving `Model` from the chain head to qualify `filter_by` columns). Build the shared CST-equality utility here.
- **Week 3:** result-shape `.scalars()` logic (correct insertion based on terminal `.all()/.first()/.one()`), `.get()`→`session.get()`, simple `.count()`. Import injection for `select`, `func`.
- **Week 4:** harden. Build every flag detector from §1.B. Each flag emits a `FlagRecord`. Fixture suite: a realistic mini-ORM app with 20+ query patterns — positive rewrites, flagged cases, and negatives that must refuse.

**Gate G1:** the deterministic subset passes its full fixture suite. Every flag case emits the correct `FlagRecord`. No silent skip, no silent rewrite.

### Phase 2 — Verification on real code (Week 5)

- Run the full transform (rewrite + flag + coverage pre-flight) on the Phase-0 codebases.
- For each: deterministic rewrites pass the 3-gate verification (the project's own tests stay green), unsafe cases are flagged not rewritten, refused files are byte-identical.
- **The proof test:** inject an intentional wrong-semantics rewrite and confirm the test gate *catches* it. This proves the verification works, not just the rewriting. This is the single most important demo the product has.
- Flakiness handling: confirm a known-flaky test triggers a "flaky, not a real failure" path rather than a false rejection.

**Gate G2:** on a real third-party SQLAlchemy 1.x project, rewrites pass verification, unsafe cases flag, refused files untouched, the injected breakage is caught, and a flaky test does not cause a false rejection.

### Phase 3 — Paid-pilot ship (Week 6)

This is not just "publish to npm." The research's recommendation 5 is the real gate: get teams to *pay* for this specific migration.

- Version bump, CHANGELOG, README/site updated. The catalog gains one transform family — the one that matters.
- `npm publish --provenance`; PyPI wrapper bump.
- Build-in-public artifact: "We built the SQLAlchemy 2.0 migration tool that doesn't exist — and it runs your tests before it touches a line." Show the flag inventory and the coverage report; the honesty is the story.
- **Put it in front of the people who said the pain is real, with a paid-pilot ask.**

**Gate G3 (the real one):** at least one team pays for / formally commits to a pilot of the SQLAlchemy migration on their real codebase. If teams will only pay for a one-time service (not recurring tooling), that is signal to reconsider the model — see §5.

---

## 4. The coverage pre-flight (the part most tools skip)

Because verification is only as good as the tests, the product is honest about its own limits before acting. `refactron migrate sqlalchemy --preflight` reports:

```
SQLAlchemy 1.x → 2.0 migration readiness
  Query sites found:            142
   ├─ safe to auto-migrate:      98
   └─ must migrate by hand:      44  (see flags)

  Test coverage of the 98 safe sites:
   ├─ covered by tests:          61  (62%)
   └─ NOT covered:               37  (38%)  ← verification cannot prove these

  Flakiness check (suite run 3x): 2 flaky tests detected → quarantined

  Verdict: verification is meaningful for 61 of 98 sites.
           For the 37 uncovered sites, the rewrite is deterministic but
           unverified by your suite. Review these manually or add tests first.
```

This single output is a differentiator nobody else offers: it tells the user exactly how much the tool can prove, instead of pretending a green run means total safety. It directly addresses the research's central risk and builds the trust the whole product depends on.

---

## 5. Wedge-to-platform & monetization signal

- **Platform path:** SQLAlchemy is migration #1 on the reusable engine. Roadmap manifests (in rough order): Pydantic v1→v2 edge cases bump-pydantic punts on, Django deprecations, CommonJS→ESM. Plus multi-repo org rollout later (the Moderne lesson: value scales with breadth).
- **Monetization test (run during Phase 3):** do pilots pay for recurring tooling, or only a one-time migration service?
  - Recurring/expanding → build the platform (Free CLI, Pro for CI/team, Enterprise for on-prem/audit).
  - One-time-only → consider a per-migration-bounty or services-led model instead.
- **The durable asset is the verification engine** (shadow copy, atomic write/rollback, coverage pre-flight, flakiness handling), not the AST transforms. The transforms commoditize; the trust layer does not. Defend and deepen the verification engine.

---

## 6. Gates summary

| Gate | Condition |
|---|---|
| G0 | On real SQLAlchemy 1.x codebases (detector blind spot fixed first), rewrite-subset queries have enough non-flaky test coverage that verification is meaningful. If not → ship flag-only / add test-gen, do not fake verification. |
| G1 | Deterministic subset passes full fixtures; every flag emits a correct `FlagRecord`; no silent skip or rewrite. |
| G2 | On a real third-party project: rewrites pass verification, unsafe cases flag, refused files untouched, injected breakage caught, flaky test does not cause false rejection. |
| G3 | At least one team pays for / commits to a pilot on their real codebase. Monetization shape (recurring vs one-time) recorded. |

---

## 7. What this plan deliberately does NOT do

- Does not auto-rewrite anything in the flag list. A wrong rewrite that passes a thin suite is the one catastrophic outcome.
- Does not ship cleanup/commodity transforms to pad the release. One migration family, on purpose.
- Does not claim "verified" without the coverage pre-flight behind it.
- Does not skip Phase 0 or the detector blind-spot fix.
- Does not put an LLM in the refactor path. The no-LLM determinism is the differentiator against exactly the AI tools whose trust is collapsing.
- Does not build SQLAlchemy as a one-off script — it is the first manifest on a reusable, migration-agnostic engine.

---

## 8. Honest risks (carried from the research)

- **Coverage ceiling:** the legacy codebases most needing migration are the likeliest to have thin/flaky tests. Mitigated by the coverage pre-flight and flakiness quarantine, and by the flag-only fallback. This is the existential risk.
- **Determinism may be smaller than hoped:** real SQLAlchemy code is messy; the flag list may swallow more than the rewrite list. Acceptable — the flag inventory is still unique value, and may itself be the lead product.
- **Effort estimates are directional:** the first query type implemented in Phase 1 calibrates the rest.
- **Monetization may be services-shaped, not tooling-shaped:** tested directly in Phase 3 before over-building the platform.
- **AI-agent competition is converging on "orchestrate + verify":** defensible today because trust in pure-LLM changes is low (2025: trust fell 40%→29%), but the window is not infinite. Move.