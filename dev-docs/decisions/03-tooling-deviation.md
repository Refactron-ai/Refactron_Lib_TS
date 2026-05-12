# ADR 003 — Defer pnpm / tsup / Biome migration

## Status

Accepted, 2026-05 (Week 1, Day 6–7).

## Context

The v2.0 execution plan's tech-stack table (Part 4) calls for pnpm
workspaces, tsup for bundling, and Biome for lint/format. This repo
currently uses npm, `tsc`, ESLint, and Prettier. User guidance during
Week 1 planning was explicit: "stay on current tooling; defer migration."

## Decision

Continue with npm + tsc + ESLint + Prettier for the 8-week v2.0 build.
Revisit after launch.

## Why defer

- Week 1's binary gate is "one e2e test fails for the right reason."
  Tooling migration does not move that gate.
- Migration cost is concentrated and risky: regenerate the lockfile
  (npm → pnpm), rewrite every `npm` step in CI, replace the `tsc` build
  chain with a `tsup` config (and re-verify `dist/cli/index.js` shebang
  + chmod + ESM resolution), and replace `.eslintrc` + `.prettierrc`
  with `biome.json`. Each item is a 1–2 day rabbit hole; combined they
  consume the Week 1 buffer.
- Risk asymmetry: a broken build mid-Week-2 caused by tooling churn is
  the worst possible blocker. The current tooling is known-green.
- The plan's binary gates do not specify any tool — they specify
  outputs (typecheck passes, lint passes, tests pass, build succeeds).
  Current tooling already meets every binary gate.

## Why the plan recommended pnpm/tsup/Biome

- **pnpm**: faster installs, better monorepo support. Refactron is not
  a monorepo today and is unlikely to become one during v2.0 (single
  npm package + a Python sidecar). Install-speed savings are real but
  small and only paid on cold installs.
- **tsup**: simpler config than `tsconfig.build.json`. True, but config
  simplicity is not on the critical path; correctness is.
- **Biome**: faster lint and a unified formatter. Real wins, but
  ESLint + Prettier currently catch what they need to (and lint already
  runs with `--max-warnings 0`).

## Consequences

- `package.json` keeps npm. CI keeps `npm ci`. Build keeps `tsc`.
  Lint keeps ESLint with `--max-warnings 0`. Format keeps Prettier.
- This deviation from Part 4 of the execution plan is recorded here
  so a future reviewer does not flag it as drift.
- A migration ADR should be written post-launch if Biome or tsup
  become unambiguous wins. Do not pre-commit to that ADR.

## References

- pnpm.io
- biomejs.dev
- tsup documentation (egoist/tsup)
- Refactron_Detailed_Execution_Plan.md, Part 4 (tech-stack table)
