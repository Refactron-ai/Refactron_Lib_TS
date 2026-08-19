# Refactron Verify -- CI Gate (Phase 2, Spec 2) -- Design

**Status:** Design / spec, pending founder review
**Date:** 2026-07-21
**Author:** Om Sherikar (with design synthesis)
**Phase:** 2, Spec 2 of 5 (see `dev-docs/refactron-phase2-roadmap-and-monetization.md`)
**Depends on:** the shipped `verifyDiff` core + `refactron verify-diff` CLI from Spec 1 (`src/verify/verify-diff.ts`, `src/cli/verify-diff-command.ts`); a v0.3.0 npm release that publishes them (see Rollout).
**Grounds in:** the strategy spec `docs/superpowers/specs/2026-06-26-refactron-verification-trust-layer-strategy.md` (sections 5 and 7) and the Spec-1 design `docs/superpowers/specs/2026-07-06-verifydiff-mcp-server-design.md`.

---

## 1. Summary

Spec 1 gave an agent a way to verify a proposed change through an MCP tool. Spec 2 gives an organization a way to verify every pull request's change before it lands, as a GitHub pull-request check. The check goes red on UNSAFE, stays green with an in-summary warning and a missing-coverage list on UNPROVEN, and passes on SAFE. It is the second distribution channel: MCP reaches individual agents, the CI gate reaches whole teams and org repos. The metric this channel exists to produce is CI retention, the signal the seed narrative rests on (strategy section 5, roadmap Spec 2 row).

The core engineering claim is that the gate is a thin, provider-specific wrapper around the already-shipped `refactron verify-diff` primitive, not new verification logic. `verifyDiff` is Mode A: it verifies a proposed change against the current working tree. The gate turns a pull request into exactly that shape by computing the PR's own diff (merge-base to head), positioning the working tree at the merge-base, and feeding the diff to `verify-diff`. Everything downstream (shadow-tree run, three-way verdict, honest UNPROVEN) is reused unchanged.

Two small CLI additions are in scope: `--fail-on-unproven` on `verify-diff` (parity with `preflight`, which already has it), and the wrapper glue that maps `verify-diff`'s exit codes to a check state and a job summary. We deliberately do not add a `--ci` flag or a `refactron verify --ci` subcommand; the reasoning is in section 4.3.

---

## 2. Goals / Non-goals

### Goals

- A GitHub Action that runs on `pull_request`, verifies the PR's diff with `verify-diff`, and reports the verdict as a pull-request check.
- Correct diff computation: the check verifies the PR's own change (merge-base to head), not the base branch's drift.
- Honest verdict mapping: UNSAFE blocks the merge; UNPROVEN is a non-blocking warning by default; SAFE passes.
- A `fail-on-unproven` escape hatch for strict repos that want UNPROVEN to block.
- Graceful, non-hostile behavior on the cases that would otherwise produce false red: docs-only or empty diffs, fork PRs without secrets, missing token, draft PRs.
- Zero mutation of the repository: the gate reads, verifies in a shadow tree, and reports. It never pushes, comments, or writes.
- Zero telemetry: nothing phones home. Retention is measured from public signals (section 4.9).
- A dogfood install on this repository, gating our own PRs, as the first consumer.

### Non-goals (explicit, deferred)

- **Change-scoped test selection.** The gate runs the whole suite (twice, per Spec 1's runtime note: once for pass/fail, once under coverage). That cost is accepted for Spec 2. Speeding it up is Spec 3 and is out of scope here.
- **Real TypeScript coverage.** Coverage is Python-only (coverage.py). A TS-only repo resolves to UNPROVEN at best. Wiring vitest/c8 coverage is Spec 3.
- **Mode B** (verifying an already-landed commit; reconstructing base from git) and base-SHA / TOCTOU hardening: Spec 4.
- **Checks API annotations** (inline per-line annotations, `conclusion: neutral`): a named fast-follow, not Spec 2's default surface (section 4.7).
- **Non-GitHub CI** (GitLab, Buildkite, Jenkins): the primitive is provider-agnostic; only the wrapper is GitHub-specific. Other providers are later wrappers, not this spec.
- **Fleet history, dashboards, audit report:** Spec 5, the paid surface.

---

## 3. User stories

- **PR author (the common case).** I open a PR. A check named "Refactron Verify" runs. If my change breaks a test, the check is red and the summary tells me which gate failed and why, so I fix it before a human reviews. If my change passes tests but the changed lines are not exercised, the check is green with a warning listing the files and lines that lack coverage, so I know the change is unproven, not proven safe.

- **Repo owner (the org adopter).** I add the Action to my repo's required checks. Now no agent-generated or human PR merges without at least attempting verification. For my Python service I want UNPROVEN to block too, so I set `fail-on-unproven: true`. I never worry the gate will mutate my repo or leak my code; it runs entirely in my own CI runner and sends nothing out.

- **Agent-driven repo (the wedge).** Most of my PRs are opened by Cursor or Claude Code. The MCP tool already lets the agent self-check, but the CI gate is the backstop that makes the agent's self-report auditable: every agent PR carries a verdict check in its history. When an agent PR is UNSAFE, it is caught in CI, not in production.

---

## 4. Design

### 4.1 Principle: a thin wrapper around a context-free primitive

The CLI stays a clean, CI-agnostic primitive. All GitHub-specific behavior (diff computation, summary rendering, fork and token detection, draft handling) lives in the Action wrapper. The wrapper drives the primitive with two contracts it already has or gains here: `--json` (machine-readable `VerdictReport`, already shipped) and `--fail-on-unproven` (added here). The wrapper reads the JSON, decides the check state, and renders the summary.

This keeps the verification logic testable without a CI harness, keeps provider coupling out of the core, and makes a future GitLab or Buildkite wrapper a pure add-on that reuses the same primitive and the same JSON.

### 4.2 The Action

A **composite action** (`action.yml`, `runs.using: composite`). Composite is the right shape because the work is a short sequence of shell steps around `npx`; it needs no container build and no compiled JS entrypoint. The distribution decision behind `npx` is section 4.8.

Full interface:

```yaml
name: Refactron Verify
description: Verify a pull request's diff (SAFE / UNSAFE / UNPROVEN) before it lands.
author: Refactron

inputs:
  base-ref:
    description: >-
      The base to diff the PR against. Defaults to the PR's base branch.
      The Action computes the merge-base of this ref and the PR head and
      diffs merge-base..head, so only the PR's own change is verified.
    required: false
    default: ${{ github.event.pull_request.base.sha }}
  working-directory:
    description: Repo subdirectory to treat as the project root (monorepo support).
    required: false
    default: '.'
  test-cmd:
    description: >-
      Override the auto-detected test command. Passed through to
      `verify-diff --test-cmd`. Same string is normalized for the coverage
      run (a leading `python -m ` is stripped internally).
    required: false
    default: ''
  fail-on-unproven:
    description: >-
      Treat UNPROVEN as a failure (red check) instead of a warning.
      Default false: UNPROVEN is a non-blocking warning.
    required: false
    default: 'false'
  require-auth:
    description: >-
      If true, a missing REFACTRON_TOKEN fails the check (for trusted repos
      that consider a misconfigured token a hard error). Default false:
      a missing token produces a neutral skip, which is the fork-safe default.
    required: false
    default: 'false'
  skip-draft:
    description: Skip verification on draft PRs. Default false (drafts are verified).
    required: false
    default: 'false'
  refactron-version:
    description: npm version range for the refactron CLI used via npx.
    required: false
    default: '^0.3.0'
  timeout-minutes:
    description: >-
      Backstop wall-clock budget for the verify step. The tests gate's own
      default is 600s (see src/verify/runners/detect.ts). Keep this above
      the expected suite runtime; the whole suite runs roughly twice.
    required: false
    default: '20'

outputs:
  verdict:
    description: SAFE | UNSAFE | UNPROVEN | SKIPPED
    value: ${{ steps.verify.outputs.verdict }}
  exit-code:
    description: The raw verify-diff exit code (0 | 1 | 2 | 7), or empty if skipped.
    value: ${{ steps.verify.outputs.exit-code }}
  report-json:
    description: Path to the written VerdictReport JSON (empty when skipped).
    value: ${{ steps.verify.outputs.report-json }}

runs:
  using: composite
  steps:
    - name: Verify PR diff
      id: verify
      shell: bash
      env:
        REFACTRON_TOKEN: ${{ env.REFACTRON_TOKEN }}
      run: ${{ github.action_path }}/verify.sh
```

The `REFACTRON_TOKEN` is supplied by the caller's workflow (`env:` on the job or step), not by the Action, so the Action never sees or transports the secret beyond passing it to the local CLI. The caller is responsible for `actions/checkout` (with `fetch-depth: 0`), Node setup, and Python setup; the Action's README states these preconditions. Bundling setup into the Action was rejected: it would force a Node and Python version on the caller and duplicate what the caller's matrix already does.

Minimal caller workflow:

```yaml
name: Refactron
on:
  pull_request:
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - uses: Refactron-ai/verify-action@v1
        with:
          fail-on-unproven: false
        env:
          REFACTRON_TOKEN: ${{ secrets.REFACTRON_TOKEN }}
```

### 4.3 CLI additions, and the `--ci` decision

**Add `--fail-on-unproven` to `verify-diff` (in scope).** Today `verify-diff` maps `verdict === 'UNSAFE' ? 1 : 0` (`src/cli/verify-diff-command.ts`), so UNPROVEN exits 0. `preflight` already has a `--fail-on-unproven` flag that exits 1 when the unproven count is greater than zero (`src/cli/preflight-command.ts`). A DX review flagged the asymmetry: two commands that both produce an unproven signal disagree on how to escalate it. Spec 2 closes the gap by adding the same flag to `verify-diff`:

- Without the flag: exit `UNSAFE ? 1 : 0` (unchanged; UNPROVEN exits 0).
- With `--fail-on-unproven`: exit `1` when the verdict is UNSAFE or UNPROVEN, else `0`.

This is a purely additive change to the command's flag parser and its final exit expression; it touches no locked file and no engine.

**Do not add `--timeout` in Spec 2 (deferred, low value).** `verifyDiff` accepts `timeoutMs`, but `verify-diff` exposes only `--test-cmd` and `--json` today. The Action backstops runtime with the job's `timeout-minutes` and the tests gate's own 600s default. Adding a CLI `--timeout` is a reasonable follow-up but is not required for the gate to work, so it stays out to keep the surface minimal. Noted as an open question if a design partner needs sub-600s control.

**Reject a `--ci` flag / `refactron verify --ci` subcommand.** The roadmap row writes the channel as "GitHub Action / `refactron verify --ci`," but that phrasing is a shorthand, not a design mandate. A `--ci` mode would fold provider-specific behavior (writing `GITHUB_STEP_SUMMARY`, reading `github.event.*`, fork detection) into the core CLI. That couples the primitive to one CI provider, makes it harder to unit-test, and duplicates what the Action wrapper does better. The cost of being wrong here is a CLI surface we would have to keep backward-compatible forever. The alternative, keeping CI glue in the wrapper and driving the CLI through `--json` plus `--fail-on-unproven`, is more boring, more testable, and provider-neutral. It wins on the constraint that the CLI must stay a context-free primitive (section 4.1). What we give up: a single-binary "it just knows it's in CI" ergonomic, which is not worth the coupling. If a strong future need appears (for example a provider with no wrapper story), we revisit; YAGNI until then.

### 4.4 Diff computation

`verifyDiff` reads base file contents from `repoRoot` on disk and applies the unified diff forward to produce the new content (`editsFromUnifiedDiff` in `src/verify/diff-input.ts`). For a PR this means two things must be true at the same time:

1. The diff fed to `verify-diff` is the PR's own change: `git diff <merge-base> <head>`.
2. The working tree on disk is at the **merge-base**, so that base-plus-forward-diff reconstructs the head content. If the tree were at head, the patch would already be present and `applyPatch` would return false, surfacing as `DiffApplyError` (a "stale base" exit 2).

The wrapper (`verify.sh`) therefore does, in order:

```bash
# Caller checked out head.sha with fetch-depth: 0.
BASE="${INPUT_BASE_REF}"                       # default: base.sha
MB="$(git merge-base "$BASE" HEAD)"            # PR fork point
git diff --no-color "$MB" HEAD -- . > pr.diff  # PR's own change, forward
if [ ! -s pr.diff ]; then                      # empty diff -> neutral skip
  echo "verdict=SKIPPED" >> "$GITHUB_OUTPUT"
  # write "nothing to verify" summary; exit 0
fi
git checkout -q "$MB" -- .                      # position tree at base
git checkout -q "$MB"                           # detach at base for good measure
npx "refactron@${INPUT_REFACTRON_VERSION}" verify-diff "${INPUT_WORKING_DIRECTORY}" \
  --diff pr.diff --json ${FAIL_ON_UNPROVEN:+--fail-on-unproven} \
  ${INPUT_TEST_CMD:+--test-cmd "$INPUT_TEST_CMD"} > report.json
```

Notes:

- **`fetch-depth: 0` is required** on the caller's checkout so the merge-base exists in local history. The Action's README states this as a hard precondition and the wrapper fails loud with a clear message if `git merge-base` cannot resolve, suggesting `fetch-depth: 0`. A defensive `git fetch --deepen=50` retry before giving up covers repos that set a bounded depth.
- Checking out `head.sha` (the actual PR head) rather than the default `refs/pull/N/merge` simulated merge keeps the diff exactly the PR's commits.
- The `git checkout "$MB" -- .` places tracked files at the base; combined with the forward `pr.diff`, `verify-diff` reconstructs head content in its shadow tree. The real working tree is only ever read; the shadow tree holds the mutation.

### 4.5 Auth in CI

`verify-diff` gates on `requireAuth` (`src/cli/auth-gate.ts`), which returns exit `7` when no credential is found. In CI the credential is the `REFACTRON_TOKEN` secret; `envCredentials()` (`src/auth/credentials.ts`) treats any non-empty `REFACTRON_TOKEN` as a valid, non-expiring credential and makes no network call to validate it. `verifyDiff` itself makes no backend call either (Spec 1 section 8: runs entirely local). So the token is an identity gate, not a functional dependency.

Failure UX when the token is missing:

- **Default (`require-auth: false`):** the wrapper detects exit `7`, marks the check **SKIPPED (neutral)**, and writes a summary explaining that verification was skipped because no `REFACTRON_TOKEN` was available, with a one-line pointer to add the secret. This is the fork-safe default (section 5).
- **`require-auth: true`:** exit `7` fails the check (red) with the same explanation, for trusted repos that treat an absent token as a misconfiguration.

We do not inject a placeholder token by default. Because the verifier is local-only, an org that wants fork PRs verified without an org secret could in principle run with a dummy token (the existing self-analysis CI job does exactly this with `ci_self_analysis_dummy_token`), but doing that silently would defeat the identity gate and the retention signal, so it stays an explicit, documented opt-in rather than a default.

### 4.6 Verdict-to-check mapping (every exit code)

| `verify-diff` exit | Condition | Wrapper action | PR check state |
|---|---|---|---|
| `0` | SAFE | pass; summary shows green verdict and gates table | success |
| `0` | UNPROVEN, `fail-on-unproven` off | pass; summary shows warning verdict, uncovered lines, missingTests hints | success (warning conveyed in summary text) |
| `1` | UNSAFE | fail; summary shows the failing gate and its blockingReason | failure (blocks merge) |
| `1` | UNPROVEN, `fail-on-unproven` on | fail; summary shows uncovered lines and missingTests | failure |
| `2` | empty diff ("no edits provided") | not reached: wrapper pre-checks `pr.diff` emptiness and short-circuits to SKIPPED before invoking the CLI | success (neutral, "nothing to verify") |
| `2` | other usage/runtime error (stale base, malformed diff, bad flag) | fail; summary shows the stderr diagnostic | failure (a broken gate must be loud, not silently green) |
| `7` | missing `REFACTRON_TOKEN` | SKIPPED (neutral) by default; fail only if `require-auth: true` | success (neutral) by default |

Design rationale for the two exit-2 rows: exit 2 is overloaded (the CLI returns it for flag errors, missing `--diff`, and any `verifyDiff` throw including the empty-diff "no edits" error). The wrapper disambiguates by pre-checking diff emptiness itself, so the empty-diff case never reaches the CLI and never has to be inferred from an overloaded code. Any exit 2 that does occur is therefore a genuine tooling error and is surfaced red, because a gate that cannot run should be visible, not silently passing. This is consistent with the UNPROVEN-is-honest posture: "cannot prove" (UNPROVEN) is neutral, but "cannot run" (tooling error) is a failure the repo owner needs to see.

A note on "warning" fidelity: a normal GitHub job status is binary (success or failure). There is no native neutral or warning state without the Checks API. So UNPROVEN maps to job success with the warning carried in the summary text, not as a distinct check state. Promoting UNPROVEN and SKIPPED to a true `conclusion: neutral` is one of the reasons annotations are the named fast-follow (section 4.7).

### 4.7 PR-check surface: job summary now, annotations later

**Decision: use `GITHUB_STEP_SUMMARY` markdown, not the Checks API, for Spec 2.**

The summary contains: the verdict headline, the gates table (syntax / imports / tests with pass/fail and duration), the changed files, the uncovered-lines list, and the missingTests hints, all read from the `VerdictReport` JSON the CLI already emits. The pass/fail decision rides on the job's exit code, which drives the required-check state.

Cost of being wrong: low and reversible. Alternatives considered:

- **Checks API annotations** (inline per-line annotations, `conclusion: neutral`). Richer: it can annotate the exact uncovered lines in the PR's Files tab and express UNPROVEN as a true neutral state. But it needs a token with `checks: write`, more plumbing, and careful handling on fork PRs (where the default token is read-only). That is more surface than the demo needs.
- **A PR comment.** Rejected outright: it mutates the PR (violates the no-mutation goal, section 4.8) and creates comment spam on every push.

Job summary wins because it requires zero extra permissions (the job keeps `permissions: contents: read`), renders the full report inline in the PR's Checks tab, and demos cleanly. Annotations are the fast-follow that adds inline uncovered-line annotations and the true neutral state for UNPROVEN once the base gate has proven itself.

### 4.8 Distribution: how the Action installs the CLI

**Problem:** `verify-diff` does not exist on npm. The published `refactron@0.2.4` predates it (and predates the `refactron-mcp` bin). The Action needs an installable artifact.

Options:

- **(a) Block Spec 2 on a v0.3.0 npm release; the Action runs `npx refactron@^0.3.0 verify-diff`.**
- (b) Composite action that clones and builds from a pinned git tag on every run.
- (c) Prebuilt Docker action.

**Recommendation: (a).** Rationale:

- `npx refactron@^0.3.0` is the same distribution the MCP server already assumes (Spec 1 ships the MCP server via `npx`). One release mechanism serves both channels.
- Option (b) pays a full `npm ci && npm run build` on every PR run (slow, and it compiles TypeScript in the consumer's CI for no reason). Option (c) adds a Docker image to build, host, and security-patch, which is real ongoing cost for a solo founder and gives the runner no isolation benefit here because verification already runs in a shadow tree.
- A pinned npm version is reproducible and auditable, and `^0.3.0` lets consumers pick up patch and minor fixes without re-pinning while staying inside a compatible range.

**Migration path (resolves the chicken-and-egg):** the dogfood install on this repository does not use npm at all. It builds the CLI from the checked-out source in the same repo (`npm ci && npm run build && node dist/cli/index.js verify-diff ...`), which is both correct (we are the repo) and the bridge that lets us test and dogfood the gate before v0.3.0 is published. External consumers get the `npx` Action only after v0.3.0 lands on npm. So the sequence is: (1) build the wrapper and dogfood workflow now against local `dist/`; (2) cut v0.3.0 to npm; (3) publish the `npx`-based Action to the Marketplace. Spec 2's external release is gated on step 2; its internal dogfood is not.

### 4.9 No mutation, permissions, and the retention signal

**No mutation.** The gate reads the repo, computes a diff, verifies in `verifyDiff`'s shadow tree (an isolated temp copy), and reports via exit code and job summary. It never pushes, comments, tags, or writes to the repo. The caller workflow declares `permissions: contents: read`; nothing in the Action needs more. This is both a trust property to state in the Action description and a hard constraint the wrapper must not violate (no `gh pr comment`, no `git push`, no writes outside the shadow tree).

**Retention instrumentation, and the privacy stance.** The roadmap names CI retention as the investor metric, which creates a temptation to phone home. Spec 2 ships **zero telemetry.** The verifier makes no network call today, and the Action adds none, so "the gate runs entirely in your CI and sends us nothing" is literally true and is a selling point, not a limitation. We measure retention honestly from signals that require no phone-home:

- **GitHub Marketplace install and usage counts** (aggregate, publisher-visible) once the Action is listed.
- **Public workflow-file presence over time:** for public repos, whether `.github/workflows/*` references the Action, and whether it persists across commits, is public data we (or a small crawler) can observe. Removal within two weeks is exactly the kill-signal the strategy names (section 10 of the strategy spec).

Any server-side, per-repo retention analytics that would require sending data to us is deferred to the paid dashboard (Spec 5) and is opt-in there. Spec 2's stance is explicit: no opt-out telemetry, no default network calls, ever.

---

## 5. Edge cases

- **Empty diff / docs-only PR.** The wrapper pre-checks `pr.diff`; if it is empty (or whitespace-only), it short-circuits to SKIPPED with a "nothing to verify" summary and exit 0. This never invokes the CLI, so it never has to disambiguate the overloaded exit 2. A PR that edits only non-code files (for example only `.md`) produces a non-empty `pr.diff`; that path runs the gate, the tests pass, coverage resolves to unknown (not all edits are `.py`), and the verdict is UNPROVEN, which is green by default. The whole-suite cost on a docs-only PR is wasteful; skipping it based on changed-file globs is a Spec 3 optimization, noted, not built here.

- **Monorepo / multi-language diff.** `working-directory` scopes the project root. A mixed diff (some `.py`, some `.ts`) hits the coverage guard in `assessCoverage` (`src/verify/verify-diff.ts`): coverage is assessed only when every edit is a `.py` file, otherwise it returns `unknown` and the verdict is UNPROVEN. Gates (syntax, imports, tests) still run over the whole change, so an UNSAFE from a broken test is still caught. This is honest: we do not claim coverage we cannot measure.

- **Fork PR without secrets.** On a `pull_request` from a fork, `secrets.REFACTRON_TOKEN` is not available, so `REFACTRON_TOKEN` is empty and the CLI exits 7. Default behavior: **SKIPPED (neutral)**, with a summary explaining why. Failing a fork contributor's PR red for a missing org secret would be hostile and wrong. We deliberately do **not** use `pull_request_target` to gain secret access, because that event runs untrusted PR code with the base repo's secrets, a well-known supply-chain footgun. We accept reduced coverage on fork PRs as the safe default and let trusted-repo owners opt into a hard fail with `require-auth: true`.

- **Draft PR.** Default: verify drafts (early feedback while drafting is valuable, and the check is non-blocking until the author requests review). `skip-draft: true` skips them to save CI minutes; implemented as an early SKIPPED when `github.event.pull_request.draft` is true.

- **Stale base / malformed diff.** If `applyPatch` fails (the diff does not apply to the base on disk), `verifyDiff` throws and the CLI exits 2. The wrapper surfaces this red with the stderr diagnostic, because it means the gate could not run (most likely a checkout or `fetch-depth` misconfiguration in the caller workflow). The message points at `fetch-depth: 0` and the head-sha checkout.

- **Timeout.** The tests gate defaults to 600s (`src/verify/runners/detect.ts`). GitHub jobs default to 360 minutes, so the gate is not the binding constraint; the caller's `timeout-minutes` (default 20 in the Action's example) is the backstop. Because the suite runs roughly twice (Spec 1 runtime note), large suites should keep `timeout-minutes` comfortably above twice their single-run time until Spec 3's scoped selection lands. `test-cmd` passthrough lets a repo point the gate at a faster subset in the interim.

- **Baseline already red.** Handled by the engine, not the wrapper: `fuseVerdict` maps a tests-gate failure that carries the "baseline tests already fail" signature to UNPROVEN, not UNSAFE, so the gate never blames the PR for a pre-existing failure. The summary distinguishes "your change broke tests" from "tests were already broken."

- **No test runner detected.** Also engine-handled: a "no test runner detected" tests-gate failure maps to UNPROVEN with a clear reason, so a repo with no suite gets an honest neutral, not a red.

---

## 6. Testing plan

Reuses the repo's Vitest conventions and the existing fixture pattern (`coverage-mini` / `sqlalchemy-mini`, `python3 -m coverage` skip-probe).

**Unit (wrapper logic, extracted from the shell into a testable Node entrypoint where practical):**

- Exit-code-to-check-state mapping: each row of the section 4.6 table (0/SAFE, 0/UNPROVEN, 1/UNSAFE, 1/UNPROVEN-with-flag, 2/error, 7/missing-token), asserting the chosen check state and that SKIPPED is neutral.
- Empty-diff short-circuit: an empty `pr.diff` yields SKIPPED and never invokes the CLI.
- Summary rendering: a given `VerdictReport` JSON renders a summary containing the verdict, the gates table, the uncovered lines, and the missingTests hints.

**CLI (the `--fail-on-unproven` addition):**

- `verify-diff` on an UNPROVEN fixture exits 0 without the flag and 1 with it.
- The flag does not change UNSAFE (still 1) or SAFE (still 0).
- Parity assertion mirroring `preflight`'s existing `--fail-on-unproven` test.

**Diff computation (integration):**

- A fixture repo with a base commit and a PR commit; assert `git diff merge-base head` plus a tree at merge-base reconstructs head content through `verify-diff`, and that a tree left at head produces the stale-base error (guards the "must checkout base" invariant).

**Dogfood workflow (the first install, and the acceptance test):**

- A workflow on this repository, `.github/workflows/refactron-verify.yml`, that gates our own PRs. Because `verify-diff` is not yet on npm, it builds from source in-repo (`npm ci && npm run build && node dist/cli/index.js verify-diff ...`) rather than `npx`. This is both the bridge described in section 4.8 and the highest-fidelity integration test: the gate runs on real PRs against the real suite before any external repo sees it. It starts non-blocking (not a required check) so a false red never blocks our own work while we harden it, then is promoted to a required check once it has run clean across a dozen or so real PRs.

---

## 7. Rollout

**Sequencing and the v0.3.0 dependency.**

1. Land the `--fail-on-unproven` addition to `verify-diff` and its tests.
2. Build the Action wrapper (`action.yml` + `verify.sh` + extracted testable logic) and the dogfood workflow on this repo, running from local `dist/` (non-blocking).
3. Harden against real PRs; promote the dogfood check to required once stable.
4. Cut **v0.3.0 to npm** (publishes `verify-diff`, the MCP server, and the `VerdictReport` surface). This is the gate on external release and is a coordinated release-manager task, not a side effect of this spec.
5. Publish the `npx`-based Action to the GitHub Marketplace.

Step 4 is the hard external dependency; steps 1 to 3 do not need it.

**Docs pages needed** (authored by the documentation-engineer; the Mintlify site under `docs/` is out of scope for this internal spec but these are the pages the release needs):

- "CI gate: verify PRs before they land," a quickstart with the minimal caller workflow, the `fetch-depth: 0` and setup preconditions, and the inputs table.
- "Verdict and exit codes," documenting the section 4.6 mapping and the UNPROVEN-is-a-warning default.
- "Fork PRs and auth," explaining the neutral-skip default and `require-auth`.

**README badge.** A "Verified by Refactron" status badge for consumer READMEs, backed by the Action's check status, plus the strategy's social-proof angle (public check runs on public PRs are distribution, per strategy section 6.3). The badge is a doc/marketing artifact, not a code dependency.

---

## 8. Open questions (founder sign-off)

1. **Block external Spec 2 on a v0.3.0 npm release?** Recommendation: **yes.** `npx refactron@^0.3.0` is the cleanest distribution and reuses the MCP release path; the dogfood install bridges the gap so internal work is not blocked. Sign-off needed because it commits us to a release cut and its semver and changelog work.

2. **Default posture for UNPROVEN: warning (green) or blocking (red)?** Recommendation: **warning by default, `fail-on-unproven` to opt into blocking.** A red UNPROVEN on a TS-only repo (which cannot get coverage yet) would produce noise that gets the gate removed, which is the exact kill-signal we must avoid. Sign-off needed because it sets the out-of-box experience every adopter sees.

3. **Fork PRs with no token: neutral-skip or hard-fail?** Recommendation: **neutral-skip by default, `require-auth` to opt into failing.** Failing fork contributors red for a missing org secret is hostile and would hurt OSS adoption, and `pull_request_target` (the only way to give forks the secret) is a security footgun we will not adopt. Sign-off needed because it defines behavior on a class of PRs the founder may have a policy view on.

4. **Ship the "Verified by Refactron" README badge and rely on public check runs as the retention signal, with zero telemetry?** Recommendation: **yes.** It keeps the "we send you nothing" promise literally true and turns public PRs into distribution. Sign-off needed because it commits us to measuring retention from public signals rather than instrumenting the Action, which the founder should endorse as the honest and sufficient path to the investor metric.
