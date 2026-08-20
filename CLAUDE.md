# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Operations scaffolding (`.claude/` + repo root)

Route through these resources instead of redoing the work each session.

**Subagents (`.claude/agents/`)**: 12 senior personas (10+ yrs framing) for delegation. Each declares its peers under "Hand-offs."

| Agent                       | Use for                                                 |
| --------------------------- | ------------------------------------------------------- |
| `delivery-lead`             | Issue shaping, sizing, definition of done               |
| `principal-engineer`        | Architecture / locked-contract calls / breaking changes |
| `staff-code-reviewer`       | Adversarial pre-merge review                            |
| `security-engineer`         | Threat modeling, sidecar safety, supply chain           |
| `python-sidecar-specialist` | Verify-check sidecars, stdin/stdout protocol, refusals  |
| `typescript-architect`      | Verify engine, ts-morph, ESM, type-level safety         |
| `release-manager`           | Semver, changelog, npm + PyPI publish                   |
| `test-engineer`             | Red-first proof, fixtures, snapshot discipline          |
| `dx-engineer`               | Verdict output, CLI ergonomics, error messages          |
| `documentation-engineer`    | README, mdx, changelog tone, migrations                 |
| `performance-engineer`      | Throughput, sidecar latency, profiling                  |

Review and analysis roles (`staff-code-reviewer`, `principal-engineer`, `security-engineer`, `performance-engineer`) hold read-only tool grants: a reviewer that can edit stops arguing with itself and starts fixing, which is how review findings get quietly absorbed instead of reported.

**Issue-first workflow**

Work starts as an issue. The branch is named `<type>/<number>-<slug>`, and the PR closes the issue.

1. `/issue` shapes an intent into a well-formed issue (problem, evidence, acceptance criteria, non-goals) via `delivery-lead`, and files it.
2. `/start <number>` reads the issue, creates the branch, plans the approach, and begins test-first.
3. `/review` runs the three-lens parallel review (correctness, architecture, tests) against the current branch.
4. `/ship` verifies the work against its issue, runs the review, and opens the PR with `Closes #<n>`.

Use `/ship` instead of `gh pr create`. A branch with no issue behind it is work nobody agreed to.

**Slash commands (`.claude/commands/`)**

- `/issue`: shape an intent into a well-formed GitHub issue and file it (routes through `delivery-lead`).
- `/start <number>`: pick up an issue, branch for it, plan, begin test-first.
- `/review`: three-lens adversarial review of the current branch (correctness, architecture, tests), run in parallel.
- `/ship`: the pre-PR gate. Verify against the issue, run the review, open the PR.
- `/check-locked`: verify the locked-files invariant on the current branch.

**Rules**

- `CODE_STYLE.md`: concrete TS + Python rules
- `COMMIT_CONVENTIONS.md`: Conventional Commits + this repo's scope vocabulary + authorship rules

**Operations & navigation**

- `ARCHITECTURE.md`: engines, locked surfaces, pipeline, invariants
- `GLOSSARY.md`: verdict, gate, shadow tree, attribution, sidecar, and the rest
- `RUNBOOK.md`: release, rollback, CVE response, snapshot regeneration

**Templates**: `docs/prd/_template.md`, `docs/plans/_template.md`, `dev-docs/decisions/_template.md` (each links real examples in this repo).

**Settings & hooks (`.claude/settings.json`, `.claude/hooks/`)**: team-wide permissions plus three live hooks:

- `block-dangerous-bash.sh` (PreToolUse:Bash): blocks `--no-verify`, `--force` push, `git reset --hard`, real `npm publish`, broad `rm -rf`
- `block-locked-file-writes.sh` (PreToolUse:Write|Edit): blocks edits to `src/contracts.ts`
- `auto-format.sh` (PostToolUse:Write|Edit): runs prettier on supported files so format:check stays green
- `.githooks/commit-msg`: enforces COMMIT_CONVENTIONS (Conventional Commits shape, no AI names, no co-author trailers, 72-char subject cap). Activated by `npm install` via the `prepare` script.

**Ownership**: `.github/CODEOWNERS` auto-requests review on locked files, ADRs, ops scaffolding, and release-critical files.

When a non-trivial task arrives, the first move is usually: find or file the issue, pick the matching subagent, read the relevant rule doc, and start from the template, not from scratch.

## Common Commands

```bash
npm run build              # tsc --project tsconfig.build.json (chmods dist/cli/index.js)
npm run typecheck          # tsc --noEmit
npm run lint               # eslint, --max-warnings 0 (warnings fail)
npm run format             # prettier --write
npm run format:check       # CI-style prettier check

npm test                   # vitest run (full suite)
npm run test:watch         # vitest in watch mode
npm run test:coverage      # vitest with v8 coverage

# Single test file / single case:
npx vitest run tests/unit/<file>.test.ts
npx vitest run tests/unit/<file>.test.ts -t "<case name substring>"

# Pre-publish chain (must all pass): clean, build, typecheck, lint, test
npm run prepublishOnly

# Run the CLI locally after build:
node dist/cli/index.js <command>
```

Requires Node.js 18+ and Python 3.8+ (for Python-adapter tests).

## Locked Contract: Do Not Modify

- `src/contracts.ts`

This is the locked engine surface. It defines the engine interfaces along with
`RefactorPlan`, `FileChange`, `GateResult` and the `TransformId` union.
Structural changes require a major version bump and coordinated migration. If a
contract change seems necessary, open an issue first.

`TransformId` still lists the 20 transform literals even though the transforms
left with the refactoring product in 0.4.0. That is deliberate: narrowing a
locked contract in the same release that restructures the repo would make any
regression un-bisectable. `src/verify/verify-diff.ts` casts a synthetic
`'external-diff'` id for diffs that came from outside a pipeline. Narrow it in a
later major.

`VerdictReport` (`src/verify/verdict-fuse.ts`) is not in `contracts.ts` but is
equally public: the MCP tool and `verify-diff --json` serialize it verbatim, and
it carries `reportVersion` so consumers storing reports know which shape they
hold. Additive fields are safe; renames, removals and retypes are breaking.

## Architecture (the big picture)

- **`src/verify/`**: the verification engine. Shadow tree (`shadow-tree.ts`),
  diff intake and rejection (`diff-input.ts`), the three gates (`gates/`),
  per-language checks (`checks/`, including the Python sidecars under
  `checks/_py/`), statement mapping and coverage attribution, and
  `verdict-fuse.ts` (pure fusion into `SAFE` / `UNSAFE` / `UNPROVEN`).
- **`src/analyze/coverage/`**: `coverage.py` invocation and parsing. This is the
  only surviving piece of the old `src/analyze/` tree, and the one place that
  has to reproduce exactly what the tests gate ran. Read the governing rule at
  the top of `python-line-coverage.ts` before touching it: two false `SAFE`
  verdicts have come from this file.
- **`src/mcp/`**: the stdio MCP server (`server.ts`) exposing `verify_change`,
  which returns the same report the CLI does.
- **`src/cli/`**: `index.ts` is a two-verb dispatcher with zero-import fast paths
  (target under 10ms for `--version`); `verify-diff-command.ts` is the command.
- **`src/auth/`**: OAuth device flow and credential storage.
- **`src/ui/theme.ts`**: terminal colour tokens. The chrome is monochrome; only
  verdicts, severities and diffs carry hue.
- **`src/index.ts`**: the library entry point.

Shadow-tree isolation, honest verdict degradation and the locked contract are
the properties the rest of the system relies on. Preserve them.

## Where to Register New Things

- **Per-language check**: add `src/verify/checks/<gate>-<language>.ts`, wire it
  into the gate in `src/verify/gates/`, and test it in `tests/unit/verify/`.
  Language-specific logic stays inside the check; the gates and the engine stay
  language-agnostic.
- **Python sidecar**: add `src/verify/checks/_py/<name>.py`, and extend the
  post-build assertion in `build:verify-sidecars` so a missing copy fails the
  build instead of failing at runtime.

## Conventions

- ESM project (`"type": "module"`); use ESM imports with the `.js` extension.
- Vitest only; never import from `jest`.
- ESLint runs with `--max-warnings 0`; warnings fail CI.
- Conventional Commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:` (scopes encouraged, e.g. `fix(python-adapter): ...`).
- Follow TDD: write the failing test first, prove it red against `main`, then implement.
- A test whose prerequisite may be missing uses `it.skipIf`, never an early return. An early return reports PASSED and proves nothing.
