# ADR 010 — Week 8 Launch (npm + PyPI + Show HN)

## Status
Accepted, 2026-05-14 (Week 8, Day 55).

## Context
Through Week 7 the v2.0 engine + CLI shipped functional, with measured perf
under target on 10k and 100k LOC trees and the output-redesign work landed.
The remaining gap before v0.2.0 reaches public users is distribution: the
package needs to actually be installable from npm and PyPI, the docs site
needs to be reachable, and the launch surface (Show HN) needs to be ready
to absorb the first wave of comments without typing answers under time
pressure.

Week 8 is the publication week. Days 50-55 are subagent-driven preparation
(packaging, docs, checklists, response templates); Day 56 is the user-driven
publish + Show HN post + 12-hour engagement window. This ADR records the
decisions that shape that arc.

## Decision

### 1. Version is `0.2.0`, not `1.0.0` or `2.0.0`
The previous public version on npm was `0.1.0-beta.2`. Bumping to a small,
non-1.0 number signals "first public iteration of v2.0; not yet 1.0-stable".
1.0 is reserved for after real beta validation surfaces from HN + post-launch
users. The 2.0.0 alternative was rejected because it overclaims maturity —
the v2.0 *engine* is new, but the *user-facing contract* (CLI surface,
config schema) is too young to promise breaking-change discipline.

### 2. Defer gauntlets #2-#5
Week 7 planned five external gauntlet runs as the validation gate for 1.0.
We're shipping after gauntlet #1 only. Show HN itself becomes the external
validation surface — every issue/comment from the launch thread is a
gauntlet observation, and the resulting bug-fix cycles roll into Week 9+
triage. This saves 2-3 weeks of slip waiting for ≥3 external developers to
commit time, and trades it for a noisier feedback channel that's
self-organizing.

### 3. PyPI strategy: thin wrapper, not rewrite
Legacy `refactron` on PyPI is at v1.0.15 — a complete independent Python
implementation from before the TS rewrite. It has ~3 500 historical installs
and represents an existing user surface we don't want to abandon. The new
`refactron-py/` package is a thin wrapper that shells out to the npm CLI:
it preserves the `pip install refactron` install path while collapsing
maintenance to one engine (the TS one). Trade-off: Python-only users now
need Node.js installed locally. Mitigation: the wrapper's first invocation
detects missing `refactron` on PATH and offers to run `npm install -g
refactron` (with a confirmation prompt — never silent installs).

### 4. Mintlify for docs hosting
The docs site config already lives at `docs/mint.json` from earlier weeks.
Mintlify renders MDX with built-in navigation, search, and dark mode — all
of which would be a week of work to replicate on a custom Next.js app.
Deployment is `npx mintlify deploy` from the repo root, which is a manual
command (no GitHub Action exists for Mintlify auto-deploy on push).
Trade-off: ship-day publish has a manual step that has to be remembered and
sequenced before the Show HN post; mitigation is its line item in the
pre-ship checklist.

### 5. Demo GIF via vhs (not asciinema or animated SVG)
vhs (Charm) produces small GIFs (~1-3 MB for a 30s recording) that render
inline in GitHub README, npm package page, and PyPI long_description.
asciinema requires a JS player which doesn't render on PyPI; animated SVG
support is patchy across npm's package page. vhs's GIF output is the lowest
common denominator that works everywhere we publish. Trade-off: re-recording
requires the user to install vhs locally (no CI render path was set up
this week — flagged for Day 53 follow-up but pushed to user).

### 6. `publishConfig.access: public` + `provenance: true`
Both encoded in `package.json` even though `release.yml` already passes
`--provenance` to `npm publish`. Encoding the intent in package.json
documents it in the canonical place + survives the manual-publish path if
the GH Action is bypassed for any reason. SLSA provenance attestation is a
launch credibility signal — HN readers checking the npm page will see the
"verified provenance" badge, which matters for a tool whose pitch is
"correctness".

### 7. Day 56 is user-driven
Subagents prepared everything Day 50-55: packaging, docs, ADRs, checklists,
response templates, smoke-tests. Day 56 itself — running `npm publish` and
`twine upload`, posting the Show HN, answering comments in real time — is
not subagent-appropriate. Reasons: latency-sensitive (HN comments need
human-paced replies), requires brand voice (the response templates are
written in Om's voice and the live thread needs to sound the same), and
requires Om to be on the hook for what's said publicly. The pre-ship
checklist (`pre-ship-checklist.md`) splits subagent-verifiable items from
user-only items so Day 56 morning is a clear handoff.

## Consequences
- v0.2.0 ships on npm + PyPI on Day 56 with provenance attestation and a
  rendered demo GIF (assuming Om completes the vhs render before T-1h).
- Show HN comment-thread responses are pre-frozen and consistent in tone
  across the 12-hour engagement window.
- Python users get continuity of the `pip install refactron` install path
  without forcing the engine team to maintain two implementations.
- Future PyPI re-implementation (full native Python engine) is not blocked
  — the wrapper gives us a graceful fallback if user feedback says the
  Node.js dependency is a deal-breaker.
- Gauntlets #2-#5 are now Week 9+ work; resourcing them depends on what
  Show HN surfaces (e.g. if 5 users self-report similar bugs, gauntlets
  become unnecessary; if zero users engage substantively, gauntlets
  become essential).
- Mintlify is now a launch-critical dependency — if Mintlify has an outage
  on Day 56, the docs site link in Show HN 404s. Mitigation: the README on
  GitHub stays a self-contained fallback that covers install + first-run.

## Future work (deferred from Week 8)
- **CI-based vhs rendering** so demo.gif regenerates on every CLI surface
  change instead of requiring a local install.
- **Public extension API** for transforms (Show HN Q&A #7 promises
  "post-launch"). Wait for ≥3 transform requests to land in issues before
  designing the surface.
- **Cross-package monorepo refactors** (Show HN Q&A #8 v0.3 roadmap item).
- **Native Python engine reconsideration** if Node.js dependency feedback
  warrants it (Decision 3 trade-off).
- **Gauntlets #2-#5** if Show HN engagement is too thin to substitute.

## References
- Source-of-truth: `dev-docs/Refactron_Detailed_Execution_Plan.md` §Week 8.
- Pre-ship checklist: [`dev-docs/launch/pre-ship-checklist.md`](../launch/pre-ship-checklist.md).
- Show HN response templates: [`dev-docs/launch/show-hn-responses.md`](../launch/show-hn-responses.md).
- Docs deploy notes: [`dev-docs/launch/deploy-docs.md`](../launch/deploy-docs.md).
- Demo recording notes: [`dev-docs/launch/recording-the-demo.md`](../launch/recording-the-demo.md).
- Bench evidence cited at launch: [`bench/results-2026-05-14.txt`](../../bench/results-2026-05-14.txt).
- LOCKED contract: `src/contracts.ts` (untouched).
