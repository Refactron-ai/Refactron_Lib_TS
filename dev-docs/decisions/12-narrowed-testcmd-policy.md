# ADR-12: A narrowed test command floors the verdict at UNPROVEN

> Status: **Accepted**
> Date: 2026-08-17
> Deciders: @omsherikar

## Context

`--test-cmd` / `testCmd` is handed straight to a shell (`src/verify/runners/detect.ts:27`) and nothing inspected it. With no override, every detected runner is whole-suite by construction: `npx vitest run`, `npx jest`, `python3 -m pytest -q`, with no path arguments and no filters. The override was the only way a subset could ever run, and it was unguarded.

Issue #110 reproduced the consequence against the published 0.4.0 binary. One repo, one diff (`return x * 2` becomes `return x * 3`), two test files: `test_scale.py` executes the changed line without pinning its value, `test_report.py` pins it and fails. The only variable is the command.

```
python3 -m pytest -q                       -> UNSAFE   test_report_formats: 'value=6' == 'value=4'
python3 -m pytest -q tests/test_scale.py   -> SAFE      "Tests pass and the changed code is covered."
```

That is a false SAFE on a change that provably breaks a test sitting in the same repository, reachable through the MCP `verify_change` tool, which applies no authentication. The narrowed run reported `changedStatements {total: 1, covered: 1}`, full statement coverage, so the stricter statement rule proposed in issue #109 (ADR not yet written) does not touch this case. The two defects are independent.

The engine performs no automatic test selection anywhere; a grep of `src/` for impacted / affected / dependency-graph / call-graph vocabulary returns nothing. This decision is strictly about a caller-supplied command.

The override cannot simply be removed. Issues #95 and #98 established `PYTHONPATH=. python3 -m pytest -q` as the documented remedy for shadow bypass under editable installs, and over MCP the prefix form is the only in-band way to supply it. Any guard that misfires on those forms breaks the documented fix for a different correctness bug.

## Decision

**A test command classified as `narrowed` disqualifies SAFE and floors the verdict at UNPROVEN. A command classified as `unknown` does not.**

Classification is three-valued and lives in `src/verify/test-scope.ts` as a pure function over the command string. `full` means the command was parsed and names no filter. `narrowed` means a filter was positively identified: a positional path or node id, or a selection flag (`-k`, `-m`, `--last-failed`, `--ignore`, `--deselect` for pytest; `-t`, `--changed`, `--related`, `--shard`, `--project` for vitest; `-t`, `--testPathPattern`, `--onlyChanged`, `--findRelatedTests`, `--changedSince` and friends for jest). `unknown` means the command was not recognised: an unparsed wrapper (`make test`, `npm test`, `./run-tests.sh`), an unrecognised flag, or a directly executed script.

`unknown` deliberately does not floor, because the commands that land there are dominated by plugin flags on a full suite (`pytest --doctest-modules`), and flooring them would turn every unrecognised flag in the wild into a SAFE-killer fixable only by a pull request to us. See Alternative B for the measured version of this argument, including the two rows it leaves open. Every `unknown` carries a signal string saying why it was unrecognised, so the carve-out can be checked against field data instead of re-argued from intuition.

`--collect-only` and `--help` are classified as **narrowing**, not boolean. A flag that exits 0 without running the suite selects zero tests, still imports every test module, and coverage then marks module-level changed lines as executed. That combination produced a real false SAFE during review: a changed module constant read UNSAFE under `python3 -m pytest -q` and SAFE under the same command plus `--collect-only`.

**A leading assignment is inert only when its variable is.** `PYTHONPATH=` changes import resolution and is correctly ignored, which is what keeps the #95/#98 remedy working. `PYTEST_ADDOPTS=` is different: pytest appends its value to its own argv, so `PYTEST_ADDOPTS="-k test_scale" python3 -m pytest -q` runs one test. Discarding it unexamined answered `full`, the classifier's strongest claim, on a narrowed run: a false SAFE reached through the exact form users are told to adopt, and the only in-band way to pass environment over MCP. Values of `PYTEST_ADDOPTS`, `VITEST_ADDOPTS` and `JEST_ADDOPTS` are now scanned with the same argument scanner as the command line. Narrowing configured in the AMBIENT environment, rather than in the command string, remains out of scope and undetectable.

This rule is evadable in one step. An agent that wants SAFE can write `sh -c "pytest tests/x.py"` and land in `unknown`. The floor is a mistake-catcher, not an adversary-stopper: careless narrowing is written in the plain form, and that is what it catches. Nobody should read this ADR as claiming otherwise.

The assessment rides on `VerdictReport.testScope` as `{ scope, source, signals }`. The field is additive, so `reportVersion` stays `1`; `src/contracts.ts` is untouched. `fuseVerdict` takes it as a REQUIRED fourth parameter: an optional one would make "a new call site forgot to pass it" a silent false SAFE, which is the mechanism behind two of the three false SAFEs this project has already shipped. The FIELD stays optional, which is load-bearing for a different reason — its absence is how a consumer distinguishes a stored report from before this change from one produced by an engine that floors.

Because `narrowed` moves a verdict, every unrecognised token degrades to `unknown` rather than being guessed at. A false `narrowed` costs a user their SAFE on a legitimate command, which is the failure mode this classifier must not have.

## Alternatives considered

### Alternative A: classify and disclose only, leave the verdict alone

Report the scope and print a CLI note, but let a narrowed run still return SAFE. This was the original scope of issue #110, with the flooring deferred to a later decision.

Rejected because the defect is reachable in a shipped release through an unauthenticated tool. Shipping disclosure alone would leave a known false SAFE live for another release cycle, and the project's cardinal rule is that a false SAFE is the one unforgivable defect. The classifier accuracy evidence that deferral was meant to buy is instead delivered in the same change, as the two negative test tables described under Compliance.

### Alternative B: floor both `narrowed` and `unknown`

The strongest integrity position: anything not provably whole-suite abstains.

Rejected, but **not** for the reason it is tempting to give. The obvious argument is "wrapper commands like `make test` are everywhere and would all lose SAFE." That argument is false, and it was measured rather than assumed. `toCoverageRunArgs` (`src/analyze/coverage/python-line-coverage.ts`) declines those commands outright, so they already land on `changedLinesCovered: 'unknown'` and therefore UNPROVEN, for an unrelated reason:

| testCmd                             | coverage plan | can reach SAFE today | classifier |
| ----------------------------------- | ------------- | -------------------- | ---------- |
| `make test`                         | declined      | no                   | unknown    |
| `npm test` / `yarn test`            | declined      | no                   | unknown    |
| `tox`                               | declined      | no                   | unknown    |
| `sh -c "pytest -q"`                 | declined      | no                   | unknown    |
| `pytest --doctest-modules`          | wrapped       | **yes**              | unknown    |
| `python -m unittest tests.test_foo` | wrapped       | **yes**              | unknown    |
| `python3 tests/runtests.py auth`    | wrapped       | **yes**              | unknown    |

Flooring `unknown` would cost the wrapper commands nothing. The real cost is row 5: `pytest --doctest-modules` and `pytest -q --forked` are whole suites that classify `unknown` only because our flag table is incomplete. Flooring `unknown` turns every pytest plugin flag in the wild into a SAFE-killer fixable only by a pull request to us. That is the actual reason to reject, and it is a good one.

The last two rows are the price of that rejection: they are live false SAFEs of the same shape as #110, under a different runner. They are not closed by this ADR. See Alternative C and the follow-ups.

### Alternative C: split `unknown` into three buckets and floor only the dangerous one

`unknown` is not one situation. It is three:

1. Unrecognised runner with no arguments (`make test`, `tox`) — cannot reach SAFE anyway, so flooring gains nothing and costs nothing.
2. Recognised runner, unrecognised flag (`pytest --doctest-modules`) — a full suite in fact, SAFE reachable. Must not floor.
3. Unrecognised runner **with positional arguments** (`python -m unittest tests.test_foo`, `python3 tests/runtests.py auth`) — SAFE reachable and narrowing highly likely.

Flooring only bucket 3 closes the unittest and Django-style holes, leaves bucket 2 untouched, and degrades with a named reason rather than a guess, which is the house doctrine everywhere else in this engine.

Not rejected on merit, deferred on risk. This branch already ships one change to what SAFE means, alongside the statement rule proposed in issue #109. A third, resting on a heuristic about positional arguments to an unrecognised runner, needs its own red-first evidence: a Django-shaped fixture proving the false SAFE before the fix. Tracked as a follow-up.

### Alternative D: per-test attribution — floor only when the changed statements were covered solely by tests the narrowing selected

The most precise rule: it would floor exactly the dangerous cases and nothing else.

Rejected as not currently buildable. It requires per-test coverage attribution, which the engine does not have; coverage.py is run once over the whole suite and reports a single merged line set. Building per-test attribution is a substantial feature with its own performance cost, and it cannot gate a fix for a live false SAFE.

## Consequences

- **Positive**: the reproduced false SAFE in #110 is closed. A caller who narrows the suite gets UNPROVEN with a reason naming the signal that cost them the verdict.
- **Positive**: the scope of every run is now recorded on the report, so a stored verdict can be audited for narrowing after the fact. Previously nothing distinguished a subset SAFE from a full-suite SAFE.
- **Positive**: the fail-safe direction is preserved. Every verdict this rule changes moves SAFE to UNPROVEN; no path can move UNSAFE or UNPROVEN to SAFE.
- **Negative**: users who deliberately narrow their suite, for instance on a large repo where a full run is impractical, can no longer reach SAFE at all. They get UNPROVEN with an explanation. This is intended, and it is the cost of the rule.
- **Negative**: a classifier false positive costs a user their SAFE. The two negative test tables exist to hold that risk down, and they must grow whenever a new flag is added.
- **Neutral**: CLI exit codes do not change. SAFE and UNPROVEN both exit `0`; only UNSAFE exits `1`. No CI pipeline breaks on this change, though pipelines that parse the verdict string will see more UNPROVEN.
- **Neutral**: `unknown` commands behave exactly as before.

## Compliance

- `tests/unit/verify/test-scope.test.ts` holds the classification table, including two negative tables that are the real enforcement:
  - **AC-3**: `PYTHONPATH=.` / `PYTHONPATH=src` / `PYTHONPATH=./src` forms from issues #95 and #98 classify as `full`. A regression here silently breaks the documented remedy for shadow bypass.
  - **AC-4**: `-n auto`, `-n 4`, `-n4`, `-x`, `--maxfail=1` classify as `full`. `-n` is xdist worker count, not a filter, and fail-fast flags only stop early on failure, so a run that stopped early is red and cannot reach SAFE anyway.
- `tests/integration/verify-diff.test.ts` pins the #110 reproduction end to end: the full suite returns UNSAFE and the narrowed command returns UNPROVEN on the identical diff, plus an assertion that the narrowed run still measured `changedStatements {total: 1, covered: 1}`, which is what proves the issue #109 rule does not cover this case.
- `tests/unit/verify/verdict-fuse.test.ts` pins the fusion rule in both directions, including that omitting the scope leaves every pre-existing verdict and reason byte-identical.
- Any new flag added to a `FlagTable` in `src/verify/test-scope.ts` must arrive with a test row. The file comment says so at the top.

## Rollout / migration

- **Consumers**: a diff verified with a narrowed `testCmd` that previously read SAFE now reads UNPROVEN. The reason string names the signal and tells the reader to re-run without the filter.
- **New report field**: `testScope` appears in `--json` and in the MCP tool output. Additive; consumers ignoring unknown keys are unaffected.
- **Version**: patch, shipping as 0.4.x. The minor is reserved for a delivered milestone in this repository, not spent on a semver mechanic (see `COMMIT_CONVENTIONS.md`). Note that `^0.4.0` matches a patch, so this reaches existing users automatically. Ships alongside the issue #109 statement rule, with both called out in the changelog under a single "what SAFE now means" heading, since shipping two independent tightenings of SAFE in one release is otherwise confusing.
- **Docs**: `docs/verification/verdicts.mdx` and `docs/mcp/tool-reference.mdx` state that a narrowed `testCmd` cannot reach SAFE, and that `unknown` commands are not floored.

## Open questions / follow-ups

- [ ] Issue #109 — the independent statement-coverage rule. Decision issue #108; its ADR is not written yet, so nothing here depends on it.
- [ ] **Floor bucket 3 of `unknown`** (Alternative C): an unrecognised runner carrying positional arguments. `python -m unittest tests.test_foo` and `python3 tests/runtests.py auth` are live false SAFEs of the #110 shape that this ADR does not close. Needs a Django-shaped fixture proving the false SAFE red-first before the rule changes.
- [ ] **Add `engineVersion` to `VerdictReport`.** This release changes what `SAFE` means without changing the report shape, and issue #109 proposes a second such change. `reportVersion` answers "can I parse this?", not "what did SAFE mean when this was written?" A producer-version field is the general answer, and it stops the next semantic tightening from relitigating the same question.
- [ ] **Measure the `unknown` rate in the field.** Every `unknown` now carries a signal string. If the population is dominated by unrecognised flags on recognised runners, the carve-out was right and the fix is to grow the flag tables. If it is dominated by unrecognised runners with arguments, bucket 3 shipped too late.
- [ ] The `unknown` hole: narrowing hidden inside `make test` or a wrapper script is not caught. Revisit if evidence shows it matters in practice; the classifier already separates `unknown` from `full`, so flooring it later is a one-line change.
- [ ] Narrowing configured outside the command string (`pytest.ini` `addopts`, `PYTEST_ADDOPTS`, vitest `include`, jest `testPathIgnorePatterns`) is out of scope. `full` means "this command names no filters", not "this run was the whole suite", and the docs must not overstate it.
