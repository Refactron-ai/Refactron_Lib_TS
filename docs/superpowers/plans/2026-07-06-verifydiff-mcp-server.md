# Refactron Verify — verifyDiff + MCP Server (Phase 2, Spec 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `verifyDiff` (verify an arbitrary diff Refactron didn't author → SAFE/UNSAFE/UNPROVEN) and expose it as an MCP tool `verify_change` an AI agent calls before landing a change.

**Architecture:** `verifyDiff` is a thin adapter that composes existing units — it builds a synthetic `RefactorPlan` from `{path,newContent}` edits, runs the existing `RefactronVerifier` (pass/fail gates), then (Python only) runs the existing `reportCoverage` on an isolated shadow tree to decide covered-vs-uncovered, and fuses the two into a three-way verdict. An MCP stdio server and a thin CLI wrap it. No engine changes; no locked-file edits.

**Tech Stack:** TypeScript (ESM, `"type": "module"`, Node16 module resolution → **all relative imports need explicit `.js` extensions**), Vitest, the `diff@5` package (already a dep), `@modelcontextprotocol/sdk` + `zod` (new deps), Python `coverage.py` (shelled by the reused reporter).

## Global Constraints

- **Branch:** implement on a NEW branch off `feat/v0.3-preflight-safety-report` (that branch has the shipped `src/verify/` engine + `src/analyze/coverage/` + Phase-1 verdict this plan reuses). Do NOT branch from `main`.
- **Locked files — DO NOT edit:** `src/contracts.ts`, `src/core/models.ts`, `src/adapters/interface.ts` (a PreToolUse hook rejects writes). `FileChange` requires all four fields `{path, oldHash, newContent, transformId}`; construct with `oldHash: ''` and a synthetic transformId cast (below) — both are inert at verify time (proven by the keystone spike).
- **Synthetic transformId:** `const SYNTHETIC_TRANSFORM = 'external-diff' as unknown as TransformId;` — the double-cast bypasses the union; the engine never reads it.
- **ESM/TS:** relative imports end in `.js`. `tsconfig` has `strict`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true` — build optional object fields with conditional spread (`...(x ? { k: x } : {})`), and guard array indexing.
- **Coverage is Python-only** (`reportCoverage` uses coverage.py). Python changes → full three-way; TS/JS changes → coverage `'unknown'` → resolve to UNPROVEN when tests pass (never silently SAFE).
- **Verdict honesty (non-negotiable):** tests pass + coverage unknown/absent → UNPROVEN, never SAFE. A pre-existing baseline failure must not be reported as "your change broke it" (the tests gate already distinguishes this via its baseline run).
- **Never mutate the real repo:** all work happens in shadow-tree temp copies that are cleaned up.
- Vitest only. ESLint `--max-warnings 0`. Conventional Commits. Commit after each task.

---

## File Structure

- Create `src/verify/diff-input.ts` — `FileEdit` type; normalize `{path,newContent}[]`; parse a unified diff → edits (via `diff`); derive changed new-file line numbers.
- Create `src/verify/verdict-fuse.ts` — `Verdict`, `VerdictReport`, `CoverageAssessment` types; pure `fuseVerdict(...)`.
- Create `src/verify/verify-diff.ts` — `verifyDiff(input)` orchestrator (composes verifier + coverage + fuse).
- Create `src/cli/verify-diff-command.ts` — `runVerifyDiffCommand(argv)`; modify `src/cli/index.ts` (dispatch + help).
- Create `src/mcp/server.ts` + `src/mcp/tools/verify-change.ts` — stdio MCP server + `verify_change` tool. Modify `package.json` (deps, `bin`, build chmod).
- Create fixture `tests/fixtures/verify-diff-mini/` (Python) and tests under `tests/unit/verify/`, `tests/integration/`, `tests/unit/mcp/`.

---

### Task 1: Diff ingestion (`src/verify/diff-input.ts`)

**Files:**

- Create: `src/verify/diff-input.ts`
- Test: `tests/unit/verify/diff-input.test.ts`

**Interfaces:**

- Consumes: `applyPatch`, `parsePatch`, `structuredPatch` from `diff` (already installed; `import { ... } from 'diff'`). `applyPatch(source, patch)` returns `string | false`.
- Produces: `interface FileEdit { path: string; newContent: string }`; `interface ChangedRange { path: string; lines: number[] }`; `class DiffApplyError extends Error`; `editsFromUnifiedDiff(repoRoot, diffStr): Promise<FileEdit[]>`; `changedLinesForEdits(repoRoot, edits): Promise<ChangedRange[]>`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/verify/diff-input.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  editsFromUnifiedDiff,
  changedLinesForEdits,
  DiffApplyError,
} from '../../../src/verify/diff-input.js';

async function tmpRepo(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'diffin-'));
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(path.join(dir, path.dirname(rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), content);
  }
  return dir;
}

describe('editsFromUnifiedDiff', () => {
  it('applies a unified diff to the base to produce newContent', async () => {
    const repo = await tmpRepo({ 'a.py': 'x = 1\ny = 2\n' });
    const diff = '--- a/a.py\n+++ b/a.py\n@@ -1,2 +1,2 @@\n x = 1\n-y = 2\n+y = 3\n';
    const edits = await editsFromUnifiedDiff(repo, diff);
    expect(edits).toEqual([{ path: 'a.py', newContent: 'x = 1\ny = 3\n' }]);
  });

  it('throws DiffApplyError when the hunk does not apply to the base', async () => {
    const repo = await tmpRepo({ 'a.py': 'totally different\n' });
    const diff = '--- a/a.py\n+++ b/a.py\n@@ -1,2 +1,2 @@\n x = 1\n-y = 2\n+y = 3\n';
    await expect(editsFromUnifiedDiff(repo, diff)).rejects.toBeInstanceOf(DiffApplyError);
  });
});

describe('changedLinesForEdits', () => {
  it('reports the new-file line numbers that changed', async () => {
    const repo = await tmpRepo({ 'a.py': 'a = 1\nb = 2\nc = 3\n' });
    const edits = [{ path: 'a.py', newContent: 'a = 1\nb = 20\nc = 3\n' }];
    const ranges = await changedLinesForEdits(repo, edits);
    expect(ranges).toEqual([{ path: 'a.py', lines: [2] }]);
  });

  it('treats a brand-new file as all-lines-changed', async () => {
    const repo = await tmpRepo({});
    const edits = [{ path: 'new.py', newContent: 'a = 1\nb = 2\n' }];
    const ranges = await changedLinesForEdits(repo, edits);
    expect(ranges).toEqual([{ path: 'new.py', lines: [1, 2] }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/verify/diff-input.test.ts`
Expected: FAIL — cannot resolve `../../../src/verify/diff-input.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/verify/diff-input.ts`:

```ts
// src/verify/diff-input.ts
// Turn a change (given as {path,newContent}[] or a unified/git diff) into the
// FileEdit[] the verify pipeline consumes, and derive which new-file lines
// changed (for coverage fusion). Uses the `diff` package — no hand-rolled hunks.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { applyPatch, parsePatch, structuredPatch } from 'diff';

export interface FileEdit {
  path: string; // repo-relative
  newContent: string; // full file content
}

export interface ChangedRange {
  path: string;
  lines: number[]; // 1-indexed new-file line numbers that were added/changed
}

export class DiffApplyError extends Error {}

/** Strip a leading `a/` or `b/` git prefix. */
function stripPrefix(p: string): string {
  return p.replace(/^[ab]\//, '');
}

export async function editsFromUnifiedDiff(repoRoot: string, diffStr: string): Promise<FileEdit[]> {
  const patches = parsePatch(diffStr);
  const edits: FileEdit[] = [];
  for (const p of patches) {
    const rel = stripPrefix(p.newFileName ?? p.oldFileName ?? '');
    if (!rel || rel === '/dev/null') continue;
    let base = '';
    try {
      base = await fs.readFile(path.join(repoRoot, rel), 'utf8');
    } catch {
      base = ''; // new file
    }
    const applied = applyPatch(base, p);
    if (applied === false) {
      throw new DiffApplyError(`diff did not apply to ${rel} (stale base?)`);
    }
    edits.push({ path: rel, newContent: applied });
  }
  return edits;
}

export async function changedLinesForEdits(
  repoRoot: string,
  edits: FileEdit[],
): Promise<ChangedRange[]> {
  const out: ChangedRange[] = [];
  for (const e of edits) {
    let base = '';
    try {
      base = await fs.readFile(path.join(repoRoot, e.path), 'utf8');
    } catch {
      base = '';
    }
    const patch = structuredPatch(e.path, e.path, base, e.newContent);
    const lines: number[] = [];
    for (const hunk of patch.hunks) {
      let newLineNo = hunk.newStart;
      for (const l of hunk.lines) {
        if (l.startsWith('+')) {
          lines.push(newLineNo);
          newLineNo += 1;
        } else if (l.startsWith('-')) {
          // old-only line; does not advance the new-file counter
        } else {
          newLineNo += 1; // context line
        }
      }
    }
    out.push({ path: e.path, lines });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/verify/diff-input.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add src/verify/diff-input.ts tests/unit/verify/diff-input.test.ts
git commit -m "feat(verify): diff ingestion for arbitrary changes"
```

---

### Task 2: Verdict fusion (`src/verify/verdict-fuse.ts`)

**Files:**

- Create: `src/verify/verdict-fuse.ts`
- Test: `tests/unit/verify/verdict-fuse.test.ts`

**Interfaces:**

- Consumes: `VerificationResult`, `GateResult` from `src/contracts.ts` — `VerificationResult = { passed: boolean; gates: { syntax: GateResult; imports: GateResult; tests: GateResult }; writableChanges }`, `GateResult = { passed: boolean; durationMs: number; blockingReason?: string }`.
- Produces: `type Verdict = 'SAFE'|'UNSAFE'|'UNPROVEN'`; `interface CoverageAssessment { tool: 'coverage.py'|'none'; changedLinesCovered: boolean|'unknown'; uncovered: Array<{file:string;line:number}> }`; `interface VerdictReport {...}`; `fuseVerdict(result, changedFiles, cov): VerdictReport`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/verify/verdict-fuse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fuseVerdict, type CoverageAssessment } from '../../../src/verify/verdict-fuse.js';
import type { VerificationResult } from '../../../src/contracts.js';

const ok = { passed: true, durationMs: 1 };
function result(passed: boolean, testsReason?: string): VerificationResult {
  return {
    passed,
    gates: {
      syntax: ok,
      imports: ok,
      tests: passed
        ? ok
        : { passed: false, durationMs: 1, blockingReason: testsReason ?? 'tests failed' },
    },
    writableChanges: [],
  };
}
const covered: CoverageAssessment = {
  tool: 'coverage.py',
  changedLinesCovered: true,
  uncovered: [],
};
const uncovered: CoverageAssessment = {
  tool: 'coverage.py',
  changedLinesCovered: false,
  uncovered: [{ file: 'a.py', line: 5 }],
};
const unknown: CoverageAssessment = { tool: 'none', changedLinesCovered: 'unknown', uncovered: [] };

describe('fuseVerdict', () => {
  it('a failing gate → UNSAFE, surfacing the blocking reason', () => {
    const r = fuseVerdict(result(false, 'test_x broke'), ['a.py'], unknown);
    expect(r.verdict).toBe('UNSAFE');
    expect(r.reason).toContain('test_x broke');
  });
  it('tests pass + changed lines covered → SAFE', () => {
    expect(fuseVerdict(result(true), ['a.py'], covered).verdict).toBe('SAFE');
  });
  it('tests pass + changed lines uncovered → UNPROVEN with missingTests', () => {
    const r = fuseVerdict(result(true), ['a.py'], uncovered);
    expect(r.verdict).toBe('UNPROVEN');
    expect(r.missingTests?.[0]?.file).toBe('a.py');
  });
  it('tests pass + coverage unknown → UNPROVEN, never SAFE (fail-safe)', () => {
    expect(fuseVerdict(result(true), ['a.ts'], unknown).verdict).toBe('UNPROVEN');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/verify/verdict-fuse.test.ts`
Expected: FAIL — cannot resolve `../../../src/verify/verdict-fuse.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/verify/verdict-fuse.ts`:

```ts
// src/verify/verdict-fuse.ts
// Pure fusion of the verify engine's pass/fail gates with changed-line coverage
// into the honest three-way verdict. No I/O.
import type { VerificationResult, GateResult } from '../contracts.js';

export type Verdict = 'SAFE' | 'UNSAFE' | 'UNPROVEN';

export interface CoverageAssessment {
  tool: 'coverage.py' | 'none';
  changedLinesCovered: boolean | 'unknown';
  uncovered: Array<{ file: string; line: number }>;
}

export interface VerdictReport {
  verdict: Verdict;
  gates: { syntax: GateResult; imports: GateResult; tests: GateResult };
  changedFiles: string[];
  coverage: CoverageAssessment;
  reason: string;
  missingTests?: Array<{ file: string; hint: string }>;
}

export function fuseVerdict(
  result: VerificationResult,
  changedFiles: string[],
  cov: CoverageAssessment,
): VerdictReport {
  const base = { gates: result.gates, changedFiles, coverage: cov };

  if (!result.passed) {
    const failedGate: 'syntax' | 'imports' | 'tests' = !result.gates.syntax.passed
      ? 'syntax'
      : !result.gates.imports.passed
        ? 'imports'
        : 'tests';
    const reason = result.gates[failedGate].blockingReason ?? `${failedGate} gate failed`;
    return { verdict: 'UNSAFE', ...base, reason };
  }

  if (cov.changedLinesCovered === true) {
    return {
      verdict: 'SAFE',
      ...base,
      reason: 'Tests pass and the changed code is covered.',
    };
  }

  const reason =
    cov.changedLinesCovered === 'unknown'
      ? 'Tests pass, but coverage of the changed code could not be determined.'
      : 'Tests pass, but the changed code is not exercised by any test.';
  const missingTests = cov.uncovered.map((u) => ({
    file: u.file,
    hint: `add a test exercising ${u.file}:${u.line}`,
  }));
  return {
    verdict: 'UNPROVEN',
    ...base,
    reason,
    ...(missingTests.length > 0 ? { missingTests } : {}),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/verify/verdict-fuse.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/verify/verdict-fuse.ts tests/unit/verify/verdict-fuse.test.ts
git commit -m "feat(verify): three-way verdict fusion (SAFE/UNSAFE/UNPROVEN)"
```

---

### Task 3: `verifyDiff` core + end-to-end integration (`src/verify/verify-diff.ts`)

**Files:**

- Create: `src/verify/verify-diff.ts`
- Create fixture: `tests/fixtures/verify-diff-mini/{pytest.ini,conftest.py,calc.py,test_calc.py}`
- Test: `tests/integration/verify-diff.test.ts`

**Interfaces:**

- Consumes: `RefactronVerifier` (`src/verify/engine.ts`) — `new RefactronVerifier({ projectRoot, testCmd?, timeoutMs? })`, `.verify(plan: RefactorPlan): Promise<VerificationResult>`. `createShadowTree(sourceRoot, changes): Promise<{ path; cleanup() }>` (`src/verify/shadow-tree.ts`). `reportCoverage({ projectRoot, testCmd? })` + `normalizePath` (`src/analyze/coverage/index.ts`) → `{ coverageToolFound; coveredLines: Set<`${rel}:${line}`> }`. `fuseVerdict`, `CoverageAssessment`, `VerdictReport` (Task 2). `editsFromUnifiedDiff`, `changedLinesForEdits`, `FileEdit` (Task 1). `FileChange`, `RefactorPlan`, `TransformId` (`src/contracts.ts`).
- Produces: `interface VerifyDiffInput { repoRoot; edits?: FileEdit[]; unifiedDiff?: string; testCmd?: string; timeoutMs?: number }`; `verifyDiff(input): Promise<VerdictReport>`.

- [ ] **Step 1: Create the Python fixture (covered fn + uncovered fn)**

Create `tests/fixtures/verify-diff-mini/pytest.ini`:

```ini
[pytest]
```

Create `tests/fixtures/verify-diff-mini/conftest.py`:

```python
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
```

Create `tests/fixtures/verify-diff-mini/calc.py`:

```python
def add(a, b):
    return a + b


def unused_helper(a, b):
    return a - b
```

Create `tests/fixtures/verify-diff-mini/test_calc.py`:

```python
from calc import add


def test_add():
    assert add(2, 3) == 5
```

(Note: `add` is covered by `test_add`; `unused_helper` is never exercised. `pytest.ini` makes the engine's `detectRunner` find pytest.)

- [ ] **Step 2: Write the failing integration test**

Create `tests/integration/verify-diff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyDiff } from '../../src/verify/verify-diff.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '../fixtures/verify-diff-mini');
const TEST_CMD = 'python3 -m pytest -q';

function pythonHasCoverage(): boolean {
  try {
    execSync('python3 -c "import coverage, pytest"', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('verifyDiff (python three-way, real coverage)', () => {
  it('semantics-preserving edit to COVERED code → SAFE', async () => {
    if (!pythonHasCoverage()) return;
    const report = await verifyDiff({
      repoRoot: FIXTURE,
      edits: [
        {
          path: 'calc.py',
          newContent:
            'def add(a, b):\n    return b + a\n\n\ndef unused_helper(a, b):\n    return a - b\n',
        },
      ],
      testCmd: TEST_CMD,
    });
    expect(report.verdict).toBe('SAFE');
  }, 180_000);

  it('behavior-breaking edit to COVERED code → UNSAFE', async () => {
    if (!pythonHasCoverage()) return;
    const report = await verifyDiff({
      repoRoot: FIXTURE,
      edits: [
        {
          path: 'calc.py',
          newContent:
            'def add(a, b):\n    return a - b\n\n\ndef unused_helper(a, b):\n    return a - b\n',
        },
      ],
      testCmd: TEST_CMD,
    });
    expect(report.verdict).toBe('UNSAFE');
  }, 180_000);

  it('edit to UNCOVERED code, tests still pass → UNPROVEN', async () => {
    if (!pythonHasCoverage()) return;
    const report = await verifyDiff({
      repoRoot: FIXTURE,
      edits: [
        {
          path: 'calc.py',
          newContent:
            'def add(a, b):\n    return a + b\n\n\ndef unused_helper(a, b):\n    return a + b\n',
        },
      ],
      testCmd: TEST_CMD,
    });
    expect(report.verdict).toBe('UNPROVEN');
    expect(report.coverage.uncovered.length).toBeGreaterThanOrEqual(1);
  }, 180_000);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/integration/verify-diff.test.ts`
Expected: FAIL — cannot resolve `../../src/verify/verify-diff.js`.

- [ ] **Step 4: Write minimal implementation**

Create `src/verify/verify-diff.ts`:

```ts
// src/verify/verify-diff.ts
// Verify an arbitrary diff Refactron did NOT author. Composes the existing
// RefactronVerifier (pass/fail gates) with reportCoverage (changed-line
// coverage, Python only) into a SAFE/UNSAFE/UNPROVEN verdict. Read-only:
// never mutates the caller's repo.
import { RefactronVerifier } from './engine.js';
import { createShadowTree } from './shadow-tree.js';
import { reportCoverage, normalizePath } from '../analyze/coverage/index.js';
import { fuseVerdict, type CoverageAssessment, type VerdictReport } from './verdict-fuse.js';
import { changedLinesForEdits, editsFromUnifiedDiff, type FileEdit } from './diff-input.js';
import type { FileChange, RefactorPlan, TransformId } from '../contracts.js';

export interface VerifyDiffInput {
  repoRoot: string;
  edits?: FileEdit[];
  unifiedDiff?: string;
  testCmd?: string;
  timeoutMs?: number;
}

// Inert at verify time (keystone spike: transformId/oldHash are never read).
const SYNTHETIC_TRANSFORM = 'external-diff' as unknown as TransformId;

function toChanges(edits: FileEdit[]): FileChange[] {
  return edits.map((e) => ({
    path: e.path,
    oldHash: '',
    newContent: e.newContent,
    transformId: SYNTHETIC_TRANSFORM,
  }));
}

export async function verifyDiff(input: VerifyDiffInput): Promise<VerdictReport> {
  const edits =
    input.edits ??
    (input.unifiedDiff ? await editsFromUnifiedDiff(input.repoRoot, input.unifiedDiff) : []);
  if (edits.length === 0) {
    throw new Error('verifyDiff: no edits provided (pass `edits` or `unifiedDiff`)');
  }
  const changedFiles = edits.map((e) => e.path);

  // 1. Gates (pass/fail) — the existing verifier manages its own shadow tree.
  const verifier = new RefactronVerifier({
    projectRoot: input.repoRoot,
    ...(input.testCmd ? { testCmd: input.testCmd } : {}),
    ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
  });
  const result = await verifier.verify({
    changes: toChanges(edits),
    preconditions: [],
  } as RefactorPlan);

  // 2. Coverage (only when gates pass; Python only).
  let cov: CoverageAssessment = { tool: 'none', changedLinesCovered: 'unknown', uncovered: [] };
  if (result.passed) {
    cov = await assessCoverage(input, edits);
  }

  // 3. Fuse.
  return fuseVerdict(result, changedFiles, cov);
}

async function assessCoverage(
  input: VerifyDiffInput,
  edits: FileEdit[],
): Promise<CoverageAssessment> {
  const pyEdits = edits.filter((e) => e.path.endsWith('.py'));
  if (pyEdits.length === 0) {
    return { tool: 'none', changedLinesCovered: 'unknown', uncovered: [] };
  }
  const shadow = await createShadowTree(input.repoRoot, toChanges(edits));
  try {
    const report = await reportCoverage({
      projectRoot: shadow.path,
      ...(input.testCmd ? { testCmd: input.testCmd } : {}),
    });
    if (!report.coverageToolFound) {
      return { tool: 'none', changedLinesCovered: 'unknown', uncovered: [] };
    }
    const ranges = await changedLinesForEdits(input.repoRoot, pyEdits);
    const uncovered: Array<{ file: string; line: number }> = [];
    for (const r of ranges) {
      const rel = normalizePath(r.path);
      for (const line of r.lines) {
        if (!report.coveredLines.has(`${rel}:${line}`)) uncovered.push({ file: r.path, line });
      }
    }
    // v1 heuristic: the change is "covered" iff every changed Python file has at
    // least one changed line that was executed by the test suite (the change is
    // on a tested path). Documented limitation: partial per-line coverage still
    // reads as covered; line-level strictness is a fast-follow. Honesty is
    // preserved on the other side — zero executed changed lines → UNPROVEN.
    const changedLinesCovered = ranges.every((r) => {
      const rel = normalizePath(r.path);
      return r.lines.some((line) => report.coveredLines.has(`${rel}:${line}`));
    });
    return {
      tool: 'coverage.py',
      changedLinesCovered,
      uncovered: changedLinesCovered ? [] : uncovered,
    };
  } finally {
    await shadow.cleanup();
  }
}
```

- [ ] **Step 5: Run test to verify it passes (real, non-skipped)**

Run:

```bash
python3 -c "import coverage, pytest" || python3 -m pip install coverage pytest
npx vitest run tests/integration/verify-diff.test.ts
```

Expected: PASS — SAFE, UNSAFE, and UNPROVEN all assert against real coverage (non-skipped).

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

```bash
git add src/verify/verify-diff.ts tests/fixtures/verify-diff-mini tests/integration/verify-diff.test.ts
git commit -m "feat(verify): verifyDiff — verify an arbitrary diff end-to-end"
```

---

### Task 4: Thin CLI (`src/cli/verify-diff-command.ts` + dispatcher)

**Files:**

- Create: `src/cli/verify-diff-command.ts`
- Modify: `src/cli/index.ts` (dispatch block after the `preflight` block ~line 74; `STATIC_HELP` ~lines 10-49)
- Test: `tests/unit/cli/verify-diff-command.test.ts`

**Interfaces:**

- Consumes: `verifyDiff` (Task 3); `requireAuth` (`./auth-gate.js`) → `Promise<true|number>`; `applyColor` (`./apply-color.js`). `runVerifyDiffCommand` mirrors `runPreflightCommand`.
- Produces: `parseVerifyDiffFlags(argv): { repoRoot; diffPath: string|null; json: boolean; testCmd: string|null }`; `class VerifyDiffFlagError extends Error`; `runVerifyDiffCommand(argv): Promise<number>`.

- [ ] **Step 1: Write the failing test (flag parsing — the pure surface)**

Create `tests/unit/cli/verify-diff-command.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseVerifyDiffFlags, VerifyDiffFlagError } from '../../../src/cli/verify-diff-command.js';

describe('parseVerifyDiffFlags', () => {
  it('defaults repoRoot to "." with no flags', () => {
    expect(parseVerifyDiffFlags([])).toEqual({
      repoRoot: '.',
      diffPath: null,
      json: false,
      testCmd: null,
    });
  });
  it('parses repoRoot + --diff + --json + --test-cmd', () => {
    expect(
      parseVerifyDiffFlags(['proj/', '--diff', 'c.patch', '--json', '--test-cmd', 'pytest -q']),
    ).toEqual({
      repoRoot: 'proj/',
      diffPath: 'c.patch',
      json: true,
      testCmd: 'pytest -q',
    });
  });
  it('throws on unknown flag', () => {
    expect(() => parseVerifyDiffFlags(['--nope'])).toThrow(VerifyDiffFlagError);
  });
  it('throws on a second positional', () => {
    expect(() => parseVerifyDiffFlags(['a', 'b'])).toThrow(VerifyDiffFlagError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/cli/verify-diff-command.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write minimal implementation**

Create `src/cli/verify-diff-command.ts`:

```ts
// src/cli/verify-diff-command.ts
// `refactron verify-diff [repoRoot] --diff <file>` — verify an arbitrary diff
// and print the SAFE/UNSAFE/UNPROVEN verdict. The local primitive under the MCP tool.
import * as fs from 'node:fs/promises';
import { verifyDiff } from '../verify/verify-diff.js';
import { requireAuth } from './auth-gate.js';
import { applyColor } from './apply-color.js';

export class VerifyDiffFlagError extends Error {}

interface VerifyDiffFlags {
  repoRoot: string;
  diffPath: string | null;
  json: boolean;
  testCmd: string | null;
}

export function parseVerifyDiffFlags(argv: string[]): VerifyDiffFlags {
  let repoRoot: string | null = null;
  let diffPath: string | null = null;
  let json = false;
  let testCmd: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--json') {
      json = true;
      continue;
    }
    if (a === '--diff') {
      diffPath = argv[++i] ?? null;
      if (!diffPath) throw new VerifyDiffFlagError('--diff requires a file path');
      continue;
    }
    if (a === '--test-cmd') {
      testCmd = argv[++i] ?? null;
      if (!testCmd) throw new VerifyDiffFlagError('--test-cmd requires a command');
      continue;
    }
    if (a.startsWith('-')) throw new VerifyDiffFlagError(`unknown flag: ${a}`);
    if (repoRoot !== null) throw new VerifyDiffFlagError(`unexpected extra argument: ${a}`);
    repoRoot = a;
  }
  return { repoRoot: repoRoot ?? '.', diffPath, json, testCmd };
}

const VERDICT_COLOR: Record<string, string> = {
  SAFE: '#3fb950', // success
  UNSAFE: '#f85149', // error
  UNPROVEN: '#d29922', // warning
};

export async function runVerifyDiffCommand(argv: string[]): Promise<number> {
  const authResult = await requireAuth('verify-diff');
  if (authResult !== true) return authResult;

  let flags: VerifyDiffFlags;
  try {
    flags = parseVerifyDiffFlags(argv);
  } catch (err) {
    if (err instanceof VerifyDiffFlagError) {
      process.stderr.write(`refactron verify-diff: ${err.message}\n`);
      return 2;
    }
    throw err;
  }
  if (!flags.diffPath) {
    process.stderr.write('refactron verify-diff: --diff <file> is required\n');
    return 2;
  }

  const unifiedDiff = await fs.readFile(flags.diffPath, 'utf8');
  const report = await verifyDiff({
    repoRoot: flags.repoRoot,
    unifiedDiff,
    ...(flags.testCmd ? { testCmd: flags.testCmd } : {}),
  });

  if (flags.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(
      applyColor(`[${report.verdict}] ${report.reason}`, VERDICT_COLOR[report.verdict]) + '\n',
    );
    for (const u of report.coverage.uncovered) {
      process.stdout.write(`  uncovered: ${u.file}:${u.line}\n`);
    }
  }
  return report.verdict === 'UNSAFE' ? 1 : 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/cli/verify-diff-command.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire into the dispatcher + help**

In `src/cli/index.ts`, immediately after the `if (cmd === 'preflight') { ... }` block, add:

```ts
if (cmd === 'verify-diff') {
  const { runVerifyDiffCommand } = await import('./verify-diff-command.js');
  const code = await runVerifyDiffCommand(process.argv.slice(3));
  process.exit(code);
}
```

In `STATIC_HELP`, add under the `preflight` command line:

```
    verify-diff [repo] --diff <f>  Verify an arbitrary diff → SAFE/UNSAFE/UNPROVEN
```

and after the `preflight flags:` section add:

```
  verify-diff flags:
    --diff=<file>           Unified/git diff to verify (required)
    --test-cmd=<cmd>        Override the test command
    --json                  Machine-readable verdict report
```

- [ ] **Step 6: Build + verify reachable, typecheck, lint, commit**

Run:

```bash
npm run build && node dist/cli/index.js --help | grep -E "verify-diff"
npm run typecheck && npm run lint
```

Expected: the `verify-diff` help lines print; typecheck + lint clean.

```bash
git add src/cli/verify-diff-command.ts src/cli/index.ts tests/unit/cli/verify-diff-command.test.ts
git commit -m "feat(cli): verify-diff command"
```

---

### Task 5: MCP server (`src/mcp/`)

**Files:**

- Modify: `package.json` (add deps `@modelcontextprotocol/sdk` + `zod`; add `bin` entry; add build chmod)
- Create: `src/mcp/tools/verify-change.ts` (the tool handler — testable in isolation)
- Create: `src/mcp/server.ts` (stdio server entry, wires the tool)
- Test: `tests/unit/mcp/verify-change.test.ts`

**Interfaces:**

- Consumes: `verifyDiff`, `VerifyDiffInput` (Task 3); `@modelcontextprotocol/sdk/server/mcp.js` (`McpServer`), `.../server/stdio.js` (`StdioServerTransport`); `zod`.
- Produces: `verifyChangeInputSchema` (zod shape); `handleVerifyChange(args): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>`; `src/mcp/server.ts` binary.

- [ ] **Step 1: Add dependencies**

Run:

```bash
npm install @modelcontextprotocol/sdk zod
```

Expected: both added to `dependencies` in `package.json`.

- [ ] **Step 2: Write the failing test (the tool handler, called directly)**

Create `tests/unit/mcp/verify-change.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleVerifyChange } from '../../../src/mcp/tools/verify-change.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '../../fixtures/verify-diff-mini');

function pythonHasCoverage(): boolean {
  try {
    execSync('python3 -c "import coverage, pytest"', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('handleVerifyChange', () => {
  it('returns a structured verdict for a SAFE change', async () => {
    if (!pythonHasCoverage()) return;
    const res = await handleVerifyChange({
      repoRoot: FIXTURE,
      edits: [
        {
          path: 'calc.py',
          newContent:
            'def add(a, b):\n    return b + a\n\n\ndef unused_helper(a, b):\n    return a - b\n',
        },
      ],
      testCmd: 'python3 -m pytest -q',
    });
    const report = JSON.parse(res.content[0]!.text);
    expect(report.verdict).toBe('SAFE');
    expect(res.isError).toBeFalsy();
  }, 180_000);

  it('reports a diff-apply error as an error result, not a throw', async () => {
    const res = await handleVerifyChange({ repoRoot: FIXTURE });
    expect(res.isError).toBe(true);
  });
});
```

- [ ] **Step 3: Write the tool handler**

Create `src/mcp/tools/verify-change.ts`:

```ts
// src/mcp/tools/verify-change.ts
// The `verify_change` MCP tool: verify a proposed change (Mode A) and return a
// structured SAFE/UNSAFE/UNPROVEN verdict. Runs entirely local; never mutates
// the caller's repo. Handler is exported separately so it is unit-testable.
import { z } from 'zod';
import { verifyDiff, type VerifyDiffInput } from '../../verify/verify-diff.js';

export const verifyChangeInputSchema = {
  repoRoot: z.string().describe('Absolute path to the repository root'),
  edits: z
    .array(z.object({ path: z.string(), newContent: z.string() }))
    .optional()
    .describe('Proposed full-file contents (one of edits/unifiedDiff required)'),
  unifiedDiff: z.string().optional().describe('A unified/git diff to verify'),
  testCmd: z.string().optional().describe('Override the test command'),
};

export interface VerifyChangeArgs {
  repoRoot: string;
  edits?: Array<{ path: string; newContent: string }>;
  unifiedDiff?: string;
  testCmd?: string;
}

export async function handleVerifyChange(
  args: VerifyChangeArgs,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    const input: VerifyDiffInput = {
      repoRoot: args.repoRoot,
      ...(args.edits ? { edits: args.edits } : {}),
      ...(args.unifiedDiff ? { unifiedDiff: args.unifiedDiff } : {}),
      ...(args.testCmd ? { testCmd: args.testCmd } : {}),
    };
    const report = await verifyDiff(input);
    return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `verify_change failed: ${message}` }], isError: true };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
python3 -c "import coverage, pytest" || python3 -m pip install coverage pytest
npx vitest run tests/unit/mcp/verify-change.test.ts
```

Expected: PASS (2 tests; the SAFE case runs real, the error case always runs).

- [ ] **Step 5: Write the stdio server entry**

Create `src/mcp/server.ts`:

```ts
#!/usr/bin/env node
// src/mcp/server.ts
// Refactron MCP server (stdio). Exposes `verify_change` so an AI agent can verify
// a proposed change before it lands. Runs entirely local.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  verifyChangeInputSchema,
  handleVerifyChange,
  type VerifyChangeArgs,
} from './tools/verify-change.js';

const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json');
const version = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;

const server = new McpServer({ name: 'refactron', version });

server.tool(
  'verify_change',
  "Verify a proposed code change (an AI agent's, a codemod's, or a human's) against the repo's real tests, and return a SAFE/UNSAFE/UNPROVEN verdict. Runs entirely local; never mutates the repo.",
  verifyChangeInputSchema,
  async (args) => handleVerifyChange(args as VerifyChangeArgs),
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 6: Wire the binary + build chmod**

In `package.json`, add to `bin`:

```json
  "bin": {
    "refactron": "./dist/cli/index.js",
    "refactron-mcp": "./dist/mcp/server.js"
  },
```

In `package.json`, update the `build` script to also chmod the new bin (append after the existing cli chmod), e.g.:

```
"build": "tsc --project tsconfig.build.json && chmod +x dist/cli/index.js && chmod +x dist/mcp/server.js",
```

- [ ] **Step 7: Build, verify the server starts, typecheck, lint**

Run:

```bash
npm run build
node dist/mcp/server.js < /dev/null & sleep 1; kill %1 2>/dev/null || true
npm run typecheck && npm run lint
```

Expected: build succeeds (server.js is chmod'd), the server process starts without crashing on empty stdin, typecheck + lint clean.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/mcp tests/unit/mcp/verify-change.test.ts
git commit -m "feat(mcp): verify_change MCP server"
```

---

### Task 6: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the entire suite + all gates**

Run:

```bash
npm run build && npm run typecheck && npm run lint && npm test
```

Expected: build/typecheck/lint clean; full suite green (existing tests + the new diff-input, verdict-fuse, verify-diff, verify-diff-command, and mcp verify-change tests).

- [ ] **Step 2: Manual MCP smoke (optional, documents the demo)**

Run (documents the fundable demo — verify the tool responds over stdio):

```bash
node dist/cli/index.js verify-diff tests/fixtures/verify-diff-mini --diff <(cd tests/fixtures/verify-diff-mini && git diff 2>/dev/null || echo "") --test-cmd "python3 -m pytest -q" || true
```

Expected: prints a `[SAFE|UNSAFE|UNPROVEN] ...` line (or a clear "no edits" message if the diff is empty). This is a smoke, not a gate.

---

## Self-Review

**1. Spec coverage** (against `docs/superpowers/specs/2026-07-06-verifydiff-mcp-server-design.md`):

- §3 verdict model (SAFE/UNSAFE/UNPROVEN fusion) → Task 2 (`fuseVerdict`) + Task 3 (real end-to-end). ✓
- §3 Python-first / TS-unknown→UNPROVEN → Task 2 fail-safe test (`unknown → UNPROVEN`) + Task 3 assessCoverage Python-only guard. ✓ (Full TS _integration_ run deferred — the engine already covers TS verification; only the fusion is new and it's unit-tested. Stated in spec §9 scope.)
- §4.1 verifyDiff core → Task 3. §4.2 diff ingestion → Task 1. §4.3 verdict fusion → Task 2. §4.4 MCP server → Task 5. §4.5 thin CLI → Task 4. ✓
- §5 isolated shadow tree, never mutates repo → Task 3 (verifier + `createShadowTree`/`cleanup`). ✓
- §7 error handling: stale diff → `DiffApplyError` (Task 1); no runner → engine's `blockingReason` surfaced as UNSAFE (Task 2); coverage absent → unknown → UNPROVEN (Task 2/3); baseline-red distinguished (engine, surfaced in reason). ✓
- §8 runs local → inherent (all local shells). ✓
- §9 testing (unit diff-input + verdict-fuse; committed 3-verdict integration; MCP-level) → Tasks 1,2,3,5. ✓
- §10 success criteria → Task 6 full suite + the integration test proves all three verdicts. ✓

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Every code step has complete code; every run step has command + expected result. The one documented heuristic (per-file coverage rule) is fully specified in code + comment, not a placeholder.

**3. Type consistency:** `FileEdit {path,newContent}` identical in Tasks 1,3,5. `VerdictReport`/`CoverageAssessment`/`Verdict` defined in Task 2, consumed unchanged in Tasks 3,4,5. `verifyDiff(input: VerifyDiffInput)` signature identical in Task 3 (def) and Tasks 4,5 (calls). `handleVerifyChange(args)` return shape identical in Task 5 def + test. `SYNTHETIC_TRANSFORM` cast identical everywhere it appears. `reportCoverage`/`normalizePath`/`createShadowTree`/`RefactronVerifier` signatures match the code map. ✓
