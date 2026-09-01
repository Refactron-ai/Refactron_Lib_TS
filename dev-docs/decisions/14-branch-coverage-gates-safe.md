# ADR-14: A changed statement in a partially-taken branch blocks SAFE

> Status: **Accepted**
> Date: 2026-09-01
> Deciders: @omsherikar
> Closes: #117. Follow-up to ADR-11 (`11-safe-coverage-rule.md`).

## Context

`SAFE` rests on a statement-level coverage rule (ADR-11): every coverable changed
statement must have executed. But statement execution does not mean the changed
*logic* was exercised. A changed `if`/`elif` whose header ran but whose branch a
test never entered counts as "covered," so the change earns `SAFE` with a branch
nobody tested.

A changed conditional is one of the most common shapes of a real regression, and
it is exactly where a statement-level answer is weakest: the header executed, so
the statement is covered, while the behaviour that changed sits in a branch no
test took.

Real example, measured. `playground/legacy-python/dispatch.py`:

```python
    if isinstance(shape, Circle):
        return math.pi * shape.radius * shape.radius
    elif isinstance(shape, Square):
        return shape.side * shape.side
    elif isinstance(shape, Rectangle):      # line 32 — executed
        return shape.width * shape.height
    raise TypeError("unknown shape")        # line 34 — arc 32→34 never taken
```

`coverage.py --branch` reports `missing_branches: [[32, 34]]`: the arc from the
final `elif` to the `raise` was never taken, because no test passed an unknown
shape. Statement coverage of line 32 is complete. Change line 32 and it earns
`SAFE` today, with the error path untested.

ADR-11 recorded this as an explicit follow-up. #117 required the decision be made
on **measured** cost and flip rate, not asserted, because `SAFE` had already
tightened twice in the 0.4.x line and over-tightening it into unreachability
would make the verdict ignored rather than honest.

## Measurements

Both taken on this repository's `playground/` before the decision.

**Cost (AC1).** On `large-python` (1,201 files, 600 tests), a real suite:

| run | wall-clock |
| --- | --- |
| `coverage run` (statement) | 10.48s, 10.04s |
| `coverage run --branch` | 9.93s, 9.91s |

`--branch` added **no measurable runtime cost** — the branch runs were marginally
faster, within noise. The JSON report grew ~1.5x (3.66 MB → 5.60 MB), a parse
cost, not a run cost. The issue's "measurably slower" concern is not borne out.

**Flip surface (AC2).** Branch gating only flips a `SAFE` when a *changed*
statement is itself a partially-taken branch. Density of that shape:

| repo | statements | partial branches | share |
| --- | --- | --- | --- |
| `large-python` (straight-line) | 30,600 | 0 | 0% — branch gating is a no-op |
| `legacy-python` (real control flow) | 73 | 1 | 1.4% |

This is the load-bearing finding. ADR-11 flips a `SAFE` for **any** diff touching
an uncovered statement in a partially-covered file — a broad surface. Branch
gating flips only a diff whose changed lines are **conditionals with an untaken
arc** — a strict, narrow subset, and precisely the false-SAFE case. Straight-line
changes and fully-exercised conditionals are untouched. Stacking this on ADR-11
therefore adds a small, targeted flip, not a second broad tightening.

## Decision

**A changed statement that `coverage.py` reports as a partially-taken branch
blocks `SAFE`, flooring the verdict to `UNPROVEN`.**

Formally: with branch data available, a changed statement disqualifies `SAFE` if
it is the source line of an arc in the file's `missing_branches`. This is added
to the ADR-11 conjunct; both must hold for `SAFE`.

`coverage run` gains `--branch`. The JSON parse reads `missing_branches` per file
alongside the existing `executed_lines` / `missing_lines`.

Two boundaries keep the direction fail-safe:

1. **Unavailable branch data never grants `SAFE`.** An older `coverage.py`, a
   parse that yields no `missing_branches`, or a measurement failure falls back
   to the ADR-11 statement rule — it never uses absent branch data as evidence of
   a covered branch. Missing information floors, it does not clear.
2. **The rule only tightens.** It can move `SAFE` → `UNPROVEN` and nothing else.
   No path it introduces can move `UNSAFE` or `UNPROVEN` → `SAFE`, because it adds
   a conjunct to the `SAFE` condition and never touches the gate results feeding
   `UNSAFE`.

`reportVersion` stays `1`: `missing_branches` is additive to the coverage sub-
object, no field is renamed, removed or retyped. The **semantics** of `verdict`
tighten, which `engineVersion` (ADR-13) already exists to disambiguate for a
consumer storing fleet history.

Version: **patch**, shipping in 0.4.x, per the repository's earned-minor policy.
The changelog leads with what `SAFE` now means, since the version number does not
carry it.

## Alternatives considered

### Alternative A: disclose, don't block

Report partial branches as an advisory (like `changedStatements` before ADR-11)
and leave the verdict `SAFE`.

Rejected. This is the exact shape ADR-11 rejected: a verdict that claims proof it
does not have, with the shortfall disclosed beside it. Every automated consumer
gates on `verdict`, not on a branch advisory. A changed conditional with an
untested branch is a textbook false `SAFE`; disclosing it is not a substitute for
declining to certify it.

### Alternative B: gate on the partial-branch COUNT (ratio threshold)

Block only when partial branches exceed some fraction of changed statements.

Rejected for the reason ADR-11 rejected a coverage ratio: an arbitrary constant
at the centre of the honesty of the verdict, indefensible at every value, and
inexplicable in a sentence. One untested branch on a changed line is one untested
branch.

### Alternative C: leave it at statement level

The status quo. Rejected: it is the open false-SAFE surface #117 exists to close,
and the measured cost of closing it is ~zero.

## Consequences

- **Positive.** The most common regression shape — a changed conditional — can no
  longer earn `SAFE` with a branch no test entered. `SAFE` moves closer to
  meaning what its reason says.
- **Positive.** Fail-safe only. Every verdict this changes moves `SAFE` →
  `UNPROVEN`; measured flip surface is narrow and surgical.
- **Positive.** No runtime cost (measured). The usability objection the issue
  raised does not materialise: it cannot make `SAFE` unreachable for straight-line
  code (0% affected) and bites conditional changes only where a branch is
  genuinely untested.
- **Negative.** A changed conditional in a weakly-tested repo now reads
  `UNPROVEN` where it read `SAFE`. That is an honest report of an untested branch,
  but it must be explained by the reason string, not left as a bare downgrade.
- **Neutral.** Report ~1.5x larger. Parse cost only; no user-visible effect.
- **Neutral.** Exit codes unchanged — `SAFE` and `UNPROVEN` both exit 0.

## Compliance

- **Red-first (AC3):** a changed `if`/`elif` whose one branch never executes, with
  a green suite and complete statement coverage, must return `UNPROVEN`. Proven
  failing against `main` (where it returns `SAFE`) before the fix.
- **Negative (AC4):** a changed conditional whose branches are all exercised must
  still reach `SAFE`. Proven passing, so the rule does not over-block.
- **Fallback:** a run without branch data (branch parse empty) falls back to the
  ADR-11 rule and does not crash or wrongly grant `SAFE`.
- **ADR-11's cross-file statement test must keep passing unmodified**, proving the
  statement conjunct was not traded away.

## Open questions / follow-ups

- [ ] Path and condition coverage (`a and b` where only `a` was evaluated). A
      strictly larger gap than branches; out of scope here.
- [ ] Non-Python languages. Coverage is Python-only, so this rule never applies to
      a TypeScript diff, which already caps at `UNPROVEN`.
- [ ] #116, mutation testing: coverage — statement or branch — proves a line
      *executed*, not that a test *asserts* on it. The next layer.
