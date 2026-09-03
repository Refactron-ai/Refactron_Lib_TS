# ADR-16: Opt-in stability check, downgrade-only

> Status: **Accepted**
> Date: 2026-09-03
> Deciders: @omsherikar
> Closes: #146 (the investigation). Like ADR-15, this records the spike and adopts an implementation in one step.

## Context

`SAFE` proves a changed statement executed and that a test asserts on it (with
`--mutate`). Neither proves the test passed because behaviour is preserved rather
than by luck. A test that passes on the single changed-tree run because of
randomness, ordering, timing, or hash-seed dependence still counts toward `SAFE`.
The tests gate runs the changed suite **once** and trusts a green after-run on the
fast path, with no stability check.

This is a genuine `SAFE`-integrity gap. In the common case the change is fine and
the test is merely flaky, so the `SAFE` is untrustworthy rather than wrong. In the
**masking** case — the diff introduces a break a *stable* test would catch, and
the flaky test happens to pass on the one run — it is a false `SAFE`, the one
class this project treats as unforgivable.

The fail→heal direction is already covered (a NEW failure that vanishes on a
fresh-shadow retry is flagged and floors to `UNPROVEN` via the C1 rule). This ADR
is the opposite direction: a lucky **pass**.

The issue required the decision be made on measured numbers, and forbade any rule
where a stable-looking rerun could **strengthen** a verdict.

## Measurements

Taken against passing suites (a green suite is a precondition — the check only
runs on a would-be-`SAFE` verdict). A rerun's cost is one suite execution plus a
fresh-shadow copy. The last row is a **real repo** (`playground/large-python`,
600 modules / 1200 tests), the others purpose-built fixtures.

| suite | shadow copy | one suite run | stability (K=3) | per-rerun |
| --- | --- | --- | --- | --- |
| 30 tests | — | ~1.23s | ~2.80s | ~0.93s |
| 200 tests | — | ~1.32s | ~4.13s | ~1.38s |
| `large-python` (1200 tests) | ~0.58s | ~13.8s | ~53.7s | ~17.9s |

`--flaky-check` adds **K full-suite runs** (default K=3), each ≈ one suite
execution plus a shadow copy (the copy is sub-second even on the 1200-file real
repo; the suite runtime dominates). On `large-python` that is **+~54s** for K=3,
and the check correctly returned no variance on that genuinely stable suite (no
over-block). End-to-end, a base verify already runs the suite about five times
(baseline retries + after-run + coverage), so `--flaky-check` ran roughly 1.0–1.9x
a plain verify on the small fixtures; the added time scales with suite runtime.
Minutes-scale on a large suite. Too slow for the default gate; affordable only
when opted into.

**The hole reproduced.** A diff whose only covering test is
`assert os.environ.get("PYTHONHASHSEED") in (None, "0")` earns `[SAFE]` with no
flaky signal: the verdict rests on a condition that varies with the hash seed.
Under `--flaky-check` the seed-1 and seed-2 reruns fail, the outcome varies, and
the verdict floors to `UNPROVEN`.

## Decision

**Add an opt-in stability mode (`--flaky-check`, off by default) that can only
DOWNGRADE.** After a would-be-`SAFE` verdict, it reruns the caller's suite K times
on **fresh shadow trees**, each under a different `PYTHONHASHSEED`. If any test's
outcome **varies** — the gate saw green, a rerun goes red — the green was never
stable, so the verdict cannot be `SAFE`; it floors at `UNPROVEN`, naming the
flaky test.

Three properties make this sound:

1. **Downgrade-only.** A confirmed variance floors `SAFE` → `UNPROVEN`. Reruns
   that all agree, the check not being requested, and every conjunct else
   strengthen **nothing** — `SAFE` still requires gates, coverage, branch, scope,
   and (under `--mutate`) no survivor. No rerun result ever earns `SAFE`. This is
   the constraint #146 made mandatory.
2. **Off by default.** The fast gate an agent calls before every merge is
   untouched. Minutes-scale cost is paid only when a caller asks for depth.
3. **Fresh shadow per rerun.** State a first run mutates into the tree cannot mask
   an order/state flake on the next, the same isolation the fail→heal retry uses.
   Reusing one tree would let a state-dependent heal hide a real flake — a
   masking-`SAFE` risk, not merely a weaker check.

**Variance provocation is `PYTHONHASHSEED`.** Seed 0 disables hash randomization
(a canonical ordering); the rest pick distinct randomized orderings, which
deterministically shakes out dict/set-order-dependent tests. Timing, network, and
`random`-based flakes are probabilistic: K reruns give K chances, stated honestly
rather than claimed as exhaustive.

**Inconclusive reruns do not downgrade.** A rerun whose run times out is
inconclusive: it is neither a confirmed green nor a confirmed red, so it is
skipped. Punishing a slow suite would be a false `UNPROVEN`. Only a confirmed red
rerun — the suite ran to completion and failed — is variance. A red rerun whose
failing ids cannot be parsed still floors, keyed by a run-level token: a parse gap
is never allowed to make the check lenient.

Python-focused, like coverage and mutation (the deep-check path only engages when
coverage is complete, which is Python-only today). `reportVersion` stays `1`: the
stability evidence is an additive optional field. `engineVersion` (ADR-13) already
distinguishes the semantics change.

**Report shape.** The stability evidence is a **sibling** `stability?:
StabilityResult` on `VerdictReport`, distinct from `flakyTests` (the fail→heal
signal from the tests gate). Naming it `stability` rather than reusing "flaky"
keeps the two signals unambiguous. The SAFE gate reads
`(stability?.varied.length ?? 0) === 0`. The block carries `ran`, `runs`,
`varied`, `inconclusive`, and `skippedReason`, so a `--flaky-check` `SAFE` where
the check was skipped or every rerun was inconclusive is disclosed rather than
reading as a clean sweep.

**Reason precedence.** A varied test outranks a surviving mutant in the reason: a
flaky suite makes the mutation result itself unreliable, so the stability fact is
the more fundamental one to surface. It ranks below narrowed/fail→heal, which
describe a suite that never ran a stable full green at all.

## Alternatives considered

### A default (always-on) stability check
Rejected on the measured cost: K extra full-suite runs per verification would
break the MCP wedge, where an agent calls `verify_change` in its edit loop. Depth
is opt-in.

### Letting a stable K-run green strengthen SAFE
Rejected, and forbidden by the issue. K identical greens are a sample, not proof
of determinism. The mode may only ever remove doubt-free status, never confer it.

### Per-test variance parsing as the authoritative signal
Rejected as the floor signal. The exit code of a rerun against the known-green
gate run is the authoritative variance signal; `extractFailureIds` is used only to
**name** the flaky test for disclosure. A parser that returns nothing must not
make the check lenient, so a red rerun floors even when unparseable.

### Fixing a seed to hide flakes
A non-goal, and backwards. The point is to provoke variance across seeds, not to
pin one that suppresses it.

## Consequences

- **Positive.** Closes the "passed by luck" surface for callers who opt in. A
  hash-order-dependent test that passes a single run now reads `UNPROVEN` with the
  flaky test named.
- **Positive.** Fail-safe by construction: the only verdict move is `SAFE` →
  `UNPROVEN`. It is impossible for this to create a false `SAFE`.
- **Negative.** Minutes-scale cost when enabled. Documented; opt-in.
- **Negative.** Probabilistic for timing/network/`random` flakes: K reruns catch
  them with probability, not certainty. Hash-order flakes are caught
  deterministically. The default gate's honest position — a `SAFE` assumes
  deterministic tests — is documented.
- **Neutral.** Off by default, so no existing verdict changes without the flag.

## Compliance

- Red-first: a change that passes the suite, is fully covered (would be `SAFE`),
  and whose only covering test varies with `PYTHONHASHSEED` returns `UNPROVEN`
  under `--flaky-check`. Proven against the same change without the flag (`SAFE`).
- Negative: a deterministic covering test still returns `SAFE` under
  `--flaky-check` (the mode does not over-block a stable change).
- Off-by-default: the same change without `--flaky-check` is unaffected.
- Inconclusive: a rerun that times out does not downgrade.
- Never strengthens: `--flaky-check` on an otherwise-`UNPROVEN` change (thin
  coverage) stays `UNPROVEN`; a clean stability run cannot lift it to `SAFE`.

## Open questions / follow-ups

- [ ] **Windows: a rerun that hangs leaks its process.** Same limitation as
      ADR-15 (#144): `runRunner` times out via execa, which kills the shell child
      but not the `python` grandchild, so a rerun that never terminates orphans a
      process and locks the shadow temp dir. The verdict is unaffected — a timeout
      is never variance — but the process leaks. The inconclusive path is tested
      on POSIX; the hang tests skip on win32.
- [ ] Test-order randomization (a pytest plugin) as a second variance axis, to
      catch order-dependence that hash-seed variation alone misses.
- [ ] A shared `--deep` tier that runs `--mutate` and `--flaky-check` together,
      and short-circuits mutation when the suite is found flaky (mutation of a
      flaky suite is unreliable). Kept separate for now: one flag, one feature.
      Until then, running both flags still runs mutation even when this check
      proves the suite flaky, so the `mutation` block can carry survivors that are
      flakiness artifacts. Both only downgrade, so there is no false `SAFE`; the
      reason precedence surfaces the stability fact first.
- [ ] The cheap always-on advisory that warns when a covering test contains
      non-determinism sources (#147). Complementary: this check runs the suite;
      that one reads it statically and only warns.
- [ ] Non-Python languages. Python-focused, like coverage and mutation.
