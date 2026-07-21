# G0 application-corpus harness

Reusable E2B harness that measures, for real SQLAlchemy 1.x codebases, how many
detected `session.query`/`Model.query` sites are covered by the project's own
test suite — the input to the G0 "is an auto-rewriter worth building?" gate.

See `../v0.3-phase0b-app-corpus-results.md` for the 2026-07-01 runs and why
G0-on-applications was closed as inconclusive (rewriter out of scope; `preflight`
is the product). This harness is kept for the high-signal path: **re-run it
against a real beta-user 1.x codebase** when one becomes available.

## Files

- `run_e2b.py` — spins up one E2B sandbox, installs Refactron from a packed
  tarball, and for each corpus in the `CORPORA` list: clones, pip-installs,
  smoke-checks pytest collectability, runs the driver, and aggregates the
  readiness ratio (`safe / (safe + unproven)`) against the G0 bands.
- `driver.mjs` — runs `preflight`'s exact logic (analyzer + `buildSafetyReport`)
  against one corpus dir, importing Refactron by file path to bypass the CLI
  auth gate. Prints a per-site `SafetyReport` JSON.

## Run

```bash
# 1. pack the current Refactron build next to these files:
npm run build && npm pack --pack-destination <this-dir>
# 2. drop driver.mjs's expectation: run_e2b.py looks for refactron-*.tgz + driver.mjs here
# 3. provide an E2B key (do NOT commit it) and run:
E2B_API_KEY=... python3 run_e2b.py     # writes results.json next to the script
```

## Lessons baked in (from the 2026-07-01 runs)

- **Usability requires `collectable`** — a suite that can't import produces
  all-uncovered → false STOP. Excluded.
- **Corpus criteria:** SQLAlchemy 1.4 (not <1.4), real 1.x query idioms (not 2.0
  `select()`), SQLite pytest that runs green from the root, concrete app (not a
  template), light enough to run under coverage in-budget (CTFd-scale suites
  time out).
- One real customer codebase beats any number of rotting OSS repos.
