# Refactron Verify — Arbitrary-Diff Verification + MCP Server (Phase 2, Spec 1) — Design

**Status:** Design / spec — pending founder review
**Date:** 2026-07-06
**Author:** Om Sherikar (with design synthesis)
**Phase:** 2, Spec 1 of 5 (see `dev-docs/refactron-phase2-roadmap-and-monetization.md`)
**Depends on:** the shipped `src/verify/` engine + Phase-1 coverage preflight (`src/analyze/coverage/`), both on branch `feat/v0.3-preflight-safety-report`.
**Grounds in:** the keystone feasibility spike (2026-07-04) — see that report in the session record.

---

## 1. Goal

Let an AI agent (or codemod, or human) hand Refactron a **proposed change** and get back an honest **SAFE / UNSAFE / UNPROVEN** verdict with a report — _before_ the change lands — via an **MCP tool the agent calls**. This is the fundable wedge: the trust layer agents plug into.

The demo it unlocks: _point Cursor / Claude Code at Refactron's MCP server; the agent proposes a diff, calls `verify_change`, and gets a verdict back before it merges._

### In scope (this spec)

- `verifyDiff` core — verify an arbitrary diff Refactron did not author.
- Diff ingestion — accept the change as `{path, newContent}[]` or a unified/git diff.
- Verdict fusion — SAFE / UNSAFE / UNPROVEN from (tests pass/fail) × (changed-line coverage).
- MCP server exposing one tool, `verify_change` (Mode A: verify a _proposed_ change against a clean base).
- A thin CLI entry (`refactron verify-diff`) as the local primitive under the MCP tool and for testing.

### Out of scope (fast-follow specs)

- **CI gate** (GitHub Action / `refactron verify --ci`) — Spec 2.
- **Change-scoped test selection** — Spec 3. v1 uses the engine's existing whole-suite behavior.
- **Mode B** (verify an _already-landed_ commit; reconstruct base from git) + drift/TOCTOU hardening — Spec 4.
- **Fleet / dashboard / audit layer** (the paid surface) — Spec 5.

---

## 2. Background — why this is a small lift

The keystone spike proved the v2 verifier (`src/verify/`) is **already author-agnostic**: it consumes only file _path + new content_. The `FileChange` fields `transformId`, `oldHash`, and `preconditions` are structurally required by the type but **never read at verify time** (0 reads across `src/verify/`). A hand-built plan carrying a synthetic `oldHash` and a deliberately wrong `transformId` (a JS transform id on a Python file) verified an arbitrary human-style edit end-to-end and returned correct SAFE/UNSAFE verdicts.

So the arbitrary-diff verifier is a **thin adapter that composes existing units**, not an engine rewrite. The only genuinely new logic is (a) turning a diff into `{path, newContent}[]`, (b) fusing the pass/fail gate with changed-line coverage into the three-way verdict, and (c) the MCP surface.

---

## 3. The verdict model (the core idea)

The engine alone returns pass/fail gates — it cannot say UNPROVEN. To produce the honest three-way verdict (the brand's whole thesis), `verifyDiff` **fuses the verify engine with Phase-1's coverage preflight**:

| Condition                                                                                | Verdict                                          |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------ |
| A test broke under the change (tests gate fails, or syntax/imports fail)                 | **UNSAFE**                                       |
| Tests pass **and** the changed lines are exercised by a test                             | **SAFE**                                         |
| Tests pass **but** the changed lines are not exercised (or coverage can't be determined) | **UNPROVEN** (+ which files/lines lack coverage) |

**Language caveat (explicit v1 decision):** the Phase-1 coverage reporter (`reportCoverage`) is **Python-only** (coverage.py). Therefore:

- **Python changes** get the full three-way verdict (reuses `reportCoverage` on the shadow tree; checks whether changed lines are in the covered set).
- **TypeScript/JS changes** get **SAFE / UNSAFE** from the gates, with coverage reported as `unknown` → they resolve to **UNPROVEN** when tests pass but coverage is unavailable. Wiring real TS coverage (vitest/c8) to make TS a first-class three-way is a **fast-follow** (folds naturally into Spec 3). v1 says so honestly rather than faking TS coverage — consistent with how `preflight` already reports `testCovered: 'unknown'` when the tool is absent.

---

## 4. Architecture — components

Each is a small unit with one responsibility, composing existing engine pieces.

### 4.1 `verifyDiff` core — `src/verify/verify-diff.ts`

The orchestrator. Signature (design-level; the plan pins exact types):

```ts
async function verifyDiff(input: {
  repoRoot: string;
  edits: FileEdit[]; // normalized {path, newContent}[]
  base?: string; // default: current working tree / HEAD
}): Promise<VerdictReport>;
```

Composes, in order:

1. **Shadow tree** — `createShadowTree(repoRoot, changes)` (existing, `src/verify/shadow-tree.ts`) — an isolated temp copy of the repo with the edits overlaid. **Never mutates the real working tree.**
2. **Gates** — reuse the existing `RefactronVerifier` (`src/verify/engine.ts`) → `{ passed, gates: {syntax, imports, tests} }`. A synthetic `FileChange` is built per edit (`oldHash: ''`, a placeholder `transformId` — both inert, per the spike). Tests-gate failure ⇒ UNSAFE.
3. **Coverage** (only if gates pass, Python files present) — `reportCoverage({ projectRoot: shadowRoot })` (existing, `src/analyze/coverage/`) → covered-line set; check whether the diff's changed lines are covered.
4. **Fuse** — map (gates, coverage) → `VerdictReport` (§3).

Read-only: `verifyDiff` never lands anything. Landing stays the caller's decision (and is decoupled from `verify()` already — the CLI's atomic writer is separate).

### 4.2 Diff ingestion — `src/verify/diff-input.ts`

- Accepts `{path, newContent}[]` directly (the simplest agent contract), **or**
- Parses a unified/git diff: for each file, apply hunks to the base contents to produce `newContent`. Errors clearly if a hunk doesn't apply to the base (stale diff).
- Also derives the **changed line ranges** per file (needed by coverage fusion).

### 4.3 Verdict fusion — `src/verify/verdict-fuse.ts` (or reuse `src/analyze/safety/verdict.ts` concepts)

Pure function: `(gates, changedLines, coveredLines | 'unknown') → VerdictReport`. Mirrors Phase-1's SAFE/UNPROVEN honesty. No I/O — unit-testable in isolation.

### 4.4 MCP server — `src/mcp/server.ts` + `src/mcp/tools/verify-change.ts`

A stdio MCP server (MCP TypeScript SDK) exposing one tool:

- **`verify_change`** — input `{ repoRoot: string; edits?: FileEdit[]; unifiedDiff?: string; base?: string }` (one of `edits`/`unifiedDiff` required); output: the `VerdictReport` as structured content + a concise human/agent-readable summary. Internally calls `verifyDiff`.
- Registered so it appears in Cursor / Claude Code / Codex MCP clients. Distributed via `npx` (matches how codemod ships its MCP server).

### 4.5 Thin CLI — `refactron verify-diff` (optional, `src/cli/verify-diff-command.ts`)

Local primitive: reads a diff from a file/stdin or `--path`, runs `verifyDiff`, prints the verdict (reusing the Phase-1 `format-safety` style). Also the honest thing the MCP tool wraps, and the easiest integration-test entry point. Wired into `src/cli/index.ts` like the other commands.

---

## 5. Data flow

```
agent → MCP verify_change({ repoRoot, edits|unifiedDiff })
      → diff-input: normalize → FileEdit[] + changed line ranges
      → verifyDiff:
          createShadowTree(repoRoot, edits)          # isolated temp copy
          RefactronVerifier.verify(syntheticPlan)     # syntax + imports + tests
              tests fail? → UNSAFE (stop)
          reportCoverage(shadowRoot)                  # Python; TS → unknown
          fuse(gates, changedLines, covered) → VerdictReport
      → return { verdict, gates, coverage, reason, missingTests? } to agent
agent decides whether to land. Refactron never writes to the real repo.
```

**Runtime note (v1, honest):** reusing the engine means the test suite runs for pass/fail, and `reportCoverage` runs it again under coverage — so a verification may run the suite ~2–3×. Acceptable for the demo + early design partners on small/medium repos; **Spec 3 (change-scoped selection) is the fix** and is where this is optimized (run the scoped suite once under coverage). Called out so it is not a silent surprise.

---

## 6. Interfaces / contracts

```ts
type FileEdit = { path: string; newContent: string };

type GateResult = { passed: boolean; durationMs: number; reason?: string };

type VerdictReport = {
  verdict: 'SAFE' | 'UNSAFE' | 'UNPROVEN';
  gates: { syntax: GateResult; imports: GateResult; tests: GateResult };
  changedFiles: string[];
  coverage: {
    tool: 'coverage.py' | 'none';
    changedLinesCovered: boolean | 'unknown';
    uncovered: Array<{ file: string; line: number }>;
  };
  reason: string; // one-line agent/human summary
  missingTests?: Array<{ file: string; hint: string }>; // populated for UNPROVEN
};
```

`GateResult` / the verifier result shape follow the existing `src/contracts.ts` `VerificationResult`; `VerdictReport` is the new Phase-2 surface (not a locked contract).

---

## 7. Error handling

- **Diff doesn't apply to base** (stale/malformed hunks) → structured error, not a crash; the agent is told the base moved.
- **No test runner detected** (`detectRunner` finds none) → verdict cannot be established → report `UNPROVEN` with `reason: "no test suite detected"` (honest: we can't prove anything).
- **Coverage tool absent** (Python without coverage.py) → `coverage.tool: 'none'`, `changedLinesCovered: 'unknown'` → tests-pass resolves to UNPROVEN (never silently SAFE).
- **Baseline already red** (pre-existing failures unrelated to the diff) → the engine's baseline run detects this; report distinguishes "your change broke tests" from "tests were already broken" so we never blame the diff for a pre-existing failure.
- **Syntax-broken edit** → UNSAFE at the syntax gate (fast, before running tests).
- **Timeout** → report a timeout verdict rather than hang the agent.

---

## 8. Security / trust (v1)

- **Runs entirely local.** No code leaves the machine — matches the site's FAQ promise. (This is a headline trust property; state it in the tool description too.)
- **Never mutates the real repo.** All work happens in an isolated shadow-tree temp copy; cleaned up after.
- **Base = current working tree / HEAD** by default. A base-SHA precondition + drift/TOCTOU guard is deferred to Spec 4 (noted, not silently missing).
- The MCP tool is read-only with respect to the user's repo; it returns a verdict, it does not land changes.

---

## 9. Testing strategy

- **Unit:** `diff-input` (normalize `{path,newContent}[]`; parse a unified diff; apply hunks; derive changed lines; reject stale hunks). `verdict-fuse` (all three verdicts incl. the fail-safe: tests pass + coverage unknown → UNPROVEN, never SAFE).
- **Integration (committed, the spike's PoC made permanent):** feed **SAFE, UNSAFE, and UNPROVEN** arbitrary diffs (that no Refactron transform would emit) through `verifyDiff` against a fixture and assert the verdict end-to-end. Include a Python fixture (full three-way) and a TS fixture (SAFE/UNSAFE + UNPROVEN-on-unknown-coverage).
- **MCP-level:** call `verify_change` through the server and assert the structured `VerdictReport` for a SAFE and an UNSAFE case.
- Reuses the existing test conventions (Vitest; `tests/integration/`; the `coverage-mini` / `sqlalchemy-mini` fixture pattern; `python3 -m coverage` skip-probe).

---

## 10. Success criteria

1. `verifyDiff` returns a correct SAFE / UNSAFE / UNPROVEN verdict for an arbitrary diff Refactron didn't author, proven by a committed end-to-end test (all three verdicts).
2. The `verify_change` MCP tool is callable from a real MCP client and returns the structured verdict.
3. Verifying never mutates the user's real repo (isolated shadow tree).
4. The honest failure modes hold: unknown coverage → UNPROVEN (never silently SAFE); pre-existing red ≠ "your change broke it".
5. Full existing suite stays green; build/typecheck/lint clean; no locked-file edits.

The demo works: an agent proposes a diff, calls `verify_change`, and gets SAFE/UNSAFE/UNPROVEN back before landing.

---

## 11. Known limitations → fast-follow

| Limitation (v1)                                             | Addressed by                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------- |
| Whole-suite runtime (~2–3× suite runs)                      | **Spec 3** — change-scoped test selection                     |
| TS UNPROVEN is coverage-`unknown` (no real TS coverage yet) | **Spec 3** — wire TS coverage (vitest/c8)                     |
| Mode A only (proposed changes; base = current)              | **Spec 4** — Mode B (already-landed commits) + base-SHA guard |
| No CI surface                                               | **Spec 2** — GitHub Action / `refactron verify --ci`          |
| No fleet history / audit report                             | **Spec 5** — the paid layer                                   |
