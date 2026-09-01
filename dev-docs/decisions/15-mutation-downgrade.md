# ADR-15: Opt-in mutation testing, downgrade-only

> Status: **Accepted**
> Date: 2026-09-01
> Deciders: @omsherikar
> Closes: #116 (the investigation). This ADR both records the spike and adopts an implementation, which the issue permitted ("a follow-up implementation issue" if affordable). We fold the follow-up in rather than defer it.

## Context

`SAFE` proves a changed statement **executed**. It does not prove any test would
**fail** if that statement's behaviour changed. A changed line whose result no
test asserts on counts as covered and earns `SAFE`. This is the largest remaining
false-`SAFE` surface, and unlike the others it is not a bug in a rule — it is the
ceiling of what coverage can tell us. Mutation testing is the only technique that
answers "would a test have failed?"

The issue required the decision be made on measured numbers, and forbade any rule
where a *sampled* mutation pass could **strengthen** a verdict.

## Measurements

Taken on this repo's `playground/` before deciding. Per-mutant cost is one plain
test run (mutation needs no coverage instrumentation).

| repo | suite | per-mutant | a 3-statement diff |
| --- | --- | --- | --- |
| `legacy-python` | 5 tests | ~0.68s | 4 mutants, 2.7s |
| `large-python` | 600 tests | ~3.6s | 3 mutants, 10.8s |

Cost is `(mutants) × (suite runtime)`. Mutants ≈ changed statements × operators
each (1–4). A realistic 5–15 statement diff is ~10–40 mutants, i.e. **minutes**
added on a mid-size suite. Too slow for the default gate; affordable only when
opted into.

**The hole reproduced.** On `large-python`, all three mutants of a
`return value + N` line **survived** — the tests execute that line but never
assert its result. Coverage says `SAFE`; mutation shows the tests would not
notice the change. Exactly the surface #116 describes, on a real repo.

## Decision

**Add an opt-in mutation mode (`--mutate`, off by default) that can only
DOWNGRADE.** It mutates the *changed statements* in the shadow tree, runs the
caller's suite once per mutant, and if any mutant **survives** (no test fails),
the verdict cannot be `SAFE` — it floors at `UNPROVEN`, naming the survivor.

Three properties make this sound:

1. **Downgrade-only.** A surviving mutant floors `SAFE` → `UNPROVEN`. A killed
   mutant, a clean run, or mutation not being requested strengthens **nothing** —
   `SAFE` still requires every other conjunct (gates, coverage, branch, scope).
   Sampling is therefore sound: a sampled survivor still downgrades, and no
   sampled result ever earns `SAFE`. This is the constraint #116 made mandatory.
2. **Off by default.** The fast gate an agent calls before every merge is
   untouched. Minutes-scale cost is paid only when a caller asks for depth.
3. **Bounded and isolated.** Only changed statements are mutated, in the shadow
   tree, never the caller's repo. Each mutant is applied, the suite runs, the
   mutant is reverted.

**Inconclusive mutants do not downgrade.** A mutant whose run times out or errors
for an infrastructure reason is inconclusive: it is neither a survivor nor a kill,
so it is skipped. It must not downgrade (punishing a slow suite is a false
`UNPROVEN`) and cannot strengthen. Only a confirmed survivor — the suite ran to a
clean pass with the mutant in place — downgrades.

**Operators** are AST-level, via a Python sidecar, so mutation never touches a
string literal or comment: comparison/boundary (`<`↔`<=`, `>`↔`>=`, `==`↔`!=`),
arithmetic (`+`↔`-`, `*`↔`/`, `//`↔`/`), and boolean (`and`↔`or`). A regex over
changed lines was rejected: it would mutate inside strings and produce false
survivors, i.e. false `UNPROVEN`s. Fail-safe, but needlessly noisy.

Python-only, like coverage. `reportVersion` stays `1`: the mutation evidence is
an additive optional field. `engineVersion` (ADR-13) already distinguishes the
semantics change.

**Amendment, 2026-09-01 (pre-merge review).** Two contract-shape decisions were
sharpened before the first release, while migration was still free:

- The mutation evidence is a **sibling** `mutation?: MutationResult` on
  `VerdictReport`, not a field on `CoverageAssessment`. Mutation is a different
  tool (the `mutate.py` sidecar plus suite reruns), so it does not belong under
  `coverage`'s `tool: 'coverage.py'`. The SAFE gate reads
  `(mutation?.survivors.length ?? 0) === 0`.
- A survivor carries `{ operator, mutatedTo }`, not an `"orig->repl"` string.
  The roadmap operators below (return-value, statement-deletion) cannot be
  expressed as a swap string, so the encoding would have broken on the first
  follow-up.

The block also carries `ran`, `tested`, `killed`, `inconclusive`, `truncated`
and `skippedReason`, so a `--mutate` `SAFE` where the deep check was skipped,
capped, or entirely inconclusive is disclosed rather than reading as a clean
sweep — the project's honesty rule, which the first draft violated by discarding
those counts.

## Alternatives considered

### A default (always-on) mutation gate
Rejected on the measured cost: minutes per verification would break the MCP wedge,
where an agent calls `verify_change` in its edit loop. Depth is opt-in.

### Letting a clean mutation run strengthen SAFE
Rejected, and forbidden by the issue. A mutation run is a sample of possible
behaviour changes; passing it is not proof. It may only ever remove doubt-free
status, never confer it.

### Whole-file or whole-repo mutation
Rejected as a non-goal. The changed-statement set (already computed in
`coverage-attribution.ts`) bounds the surface to what the diff touched.

## Consequences

- **Positive.** Closes the "executed but not asserted" surface for callers who opt
  in. A boundary change (`<=` → `<`) that passes a thin suite now reads
  `UNPROVEN` with the surviving mutant named.
- **Positive.** Fail-safe by construction: the only verdict move is `SAFE` →
  `UNPROVEN`. It is impossible for this to create a false `SAFE`.
- **Negative.** Minutes-scale cost when enabled. Documented; opt-in.
- **Negative.** A weakly-tested repo will see many `UNPROVEN`s under `--mutate`.
  That is an honest report of thin tests, and is why it is not the default.
- **Neutral.** Off by default, so no existing verdict changes without the flag.

## Compliance

- Red-first: a change that passes the suite, is fully covered (would be `SAFE`),
  and whose changed statement has a surviving mutant returns `UNPROVEN` under
  `--mutate`. Proven against a tree where `--mutate` is a no-op.
- Negative: a change whose mutants are all killed still returns `SAFE` under
  `--mutate` (the mode does not over-block a well-tested change).
- Off-by-default: the same change without `--mutate` is unaffected.
- Inconclusive: a mutant that times out does not downgrade.
- Never strengthens: `--mutate` on an otherwise-`UNPROVEN` change (thin coverage)
  stays `UNPROVEN`; a clean mutation run cannot lift it to `SAFE`.

## Open questions / follow-ups

- [ ] Return-value and statement-deletion operators. A larger mutant set catches
      more, at more runtime. Start with operator swaps.
- [ ] A mutant budget / sampling cap for very large diffs, so cost stays bounded.
- [ ] Non-Python languages. Python-only, like coverage.
- [ ] Condition/path coverage (#140) is a coverage-side gap; mutation is the
      assertion-side one. They are complementary.
