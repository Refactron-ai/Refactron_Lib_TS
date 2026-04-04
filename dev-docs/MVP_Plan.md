# Refactron TypeScript MVP — Execution Plan

**Version:** 2.0  
**Date:** April 2026  
**Author:** Om Sherikar  
**Stack:** TypeScript · Node.js · Ink · Tree-sitter · Semgrep  
**Distribution:** npm (primary) · PyPI (wrapper, legacy)

---

## What This Plan Covers

This is the complete execution plan for building Refactron v2.0 in TypeScript from scratch — clean architecture, no inherited Python mess. The plan covers eight weeks of engineering work, every file to create, every CI/CD workflow to wire, and every gate that must pass before the next phase starts.

The Python PyPI package stays alive as v1.x. The TypeScript rewrite ships as v2.0 on npm and becomes the primary distribution.

---

## The Three Non-Negotiables

Before any code is written, these three rules govern every decision:

**1. Lock contracts before building implementations.** `models.ts` and `interface.ts` are written, reviewed, and frozen before any other file is created. Nothing changes them after they are locked.

**2. Blast radius is not optional.** Every `CodeIssue` carries a `BlastRadius` object. There is no version of the analysis engine that skips this. It is what makes v2.0 a genuinely different product.

**3. The verification engine is language-agnostic.** It calls `ILanguageAdapter` methods. It has zero Python-specific or TypeScript-specific logic. This is enforced by TypeScript's type system — if an adapter doesn't implement the interface, it won't compile.

---

## Project Structure — Complete File Map

```
refactron/                          ← npm workspace root
├── src/
│   ├── cli/
│   │   ├── index.ts                ← fast-path dispatcher (<10ms for --version)
│   │   ├── app.tsx                 ← Ink root, mounts React tree
│   │   └── commands/
│   │       ├── analyze.tsx         ← refactron analyze
│   │       ├── autofix.tsx         ← refactron autofix
│   │       ├── verify.tsx          ← refactron verify
│   │       ├── rollback.tsx        ← refactron rollback
│   │       ├── status.tsx          ← refactron status
│   │       └── diff.tsx            ← refactron diff
│   │
│   ├── ui/                         ← Ink components (React for terminal)
│   │   ├── theme.ts                ← navy/blue palette, dark/light
│   │   ├── App.tsx                 ← ThemeProvider + AppStateProvider
│   │   ├── StatusBar.tsx           ← always-visible bottom bar
│   │   ├── IssueList.tsx           ← virtual scrolling list
│   │   ├── IssueDetail.tsx         ← expanded issue view
│   │   ├── VerificationView.tsx    ← live verification progress
│   │   ├── DiffView.tsx            ← unified diff display
│   │   ├── BlastRadiusGraph.tsx    ← blast radius visualization
│   │   └── ProgressBar.tsx         ← analysis progress
│   │
│   ├── core/
│   │   ├── models.ts               ← LOCKED FIRST — CodeIssue, VerificationResult, BlastRadius
│   │   ├── config.ts               ← RefactronConfig, YAML loader
│   │   └── orchestrator.ts         ← coordinates analysis + verification + autofix
│   │
│   ├── analysis/
│   │   ├── engine.ts               ← analysis orchestrator
│   │   ├── blast-radius.ts         ← BlastRadiusAnalyzer — THE NEW THING
│   │   ├── temporal.ts             ← git history intelligence
│   │   ├── call-graph.ts           ← function-level call graph builder
│   │   ├── import-graph.ts         ← file-level import graph builder
│   │   └── analyzers/
│   │       ├── base.ts             ← BaseAnalyzer interface
│   │       ├── complexity.ts       ← cyclomatic complexity
│   │       ├── security.ts         ← SQL injection, hardcoded secrets, eval()
│   │       ├── code-smell.ts       ← long methods, god objects, duplication
│   │       ├── dead-code.ts        ← unused vars, unreachable code
│   │       ├── type-hints.ts       ← missing annotations, implicit any
│   │       ├── dependencies.ts     ← circular deps, unused imports
│   │       └── performance.ts      ← inefficient loops, generator opportunities
│   │
│   ├── verification/
│   │   ├── engine.ts               ← language-agnostic orchestrator
│   │   ├── result.ts               ← VerificationResult dataclass (locked)
│   │   ├── atomic-writer.ts        ← temp file → os.rename() equivalent
│   │   └── checks/
│   │       ├── syntax.ts           ← delegates to adapter.verifySyntax()
│   │       ├── imports.ts          ← delegates to adapter.verifyImports()
│   │       └── test-gate.ts        ← delegates to adapter.verifyTests()
│   │
│   ├── autofix/
│   │   ├── engine.ts               ← AutoFixEngine
│   │   └── fixers/
│   │       ├── base.ts
│   │       ├── unused-imports.ts
│   │       ├── magic-numbers.ts
│   │       ├── docstrings.ts
│   │       ├── dead-code.ts
│   │       ├── type-hints.ts
│   │       ├── sort-imports.ts
│   │       ├── trailing-whitespace.ts
│   │       ├── normalize-quotes.ts
│   │       ├── simplify-boolean.ts
│   │       ├── convert-fstring.ts
│   │       ├── unused-variables.ts
│   │       ├── fix-indentation.ts
│   │       ├── missing-commas.ts
│   │       └── remove-debug.ts
│   │
│   ├── pipeline/
│   │   ├── session.ts              ← PipelineSession state machine
│   │   ├── store.ts                ← SessionStore (reads/writes .refactron/)
│   │   └── queue.ts                ← FixQueue, FixQueueItem
│   │
│   ├── adapters/
│   │   ├── interface.ts            ← ILanguageAdapter — LOCKED FIRST
│   │   ├── registry.ts             ← auto-detect language from file extension
│   │   ├── python/
│   │   │   ├── index.ts
│   │   │   ├── analyzer.ts         ← tree-sitter-python + semgrep subprocess
│   │   │   ├── fixer.ts            ← calls Python fixers via subprocess
│   │   │   └── test-runner.ts      ← pytest subprocess + import graph
│   │   └── typescript/
│   │       ├── index.ts
│   │       ├── analyzer.ts         ← tsc + semgrep
│   │       ├── fixer.ts            ← ts-morph for type-aware transforms
│   │       └── test-runner.ts      ← jest/vitest detection + import graph
│   │
│   └── infrastructure/
│       ├── backup.ts               ← pre-write backup, enables rollback
│       ├── git.ts                  ← git log parsing for temporal analysis
│       └── diff.ts                 ← unified diff generation
│
├── tests/
│   ├── fixtures/
│   │   ├── python/
│   │   │   ├── sql-injection.py
│   │   │   ├── high-complexity.py
│   │   │   ├── bad-transform.py    ← known-bad: changes behavior
│   │   │   └── safe-transform.py   ← known-safe: preserves behavior
│   │   └── typescript/
│   │       ├── any-abuse.ts
│   │       ├── eval-usage.ts
│   │       ├── bad-transform.ts
│   │       └── safe-transform.ts
│   ├── unit/
│   ├── integration/
│   └── verification/
│       └── blocks-bad-transform.test.ts   ← write this FAILING on Day 1
│
├── .github/
│   └── workflows/
│       ├── ci.yml                  ← PR checks (typecheck, lint, test)
│       ├── release.yml             ← npm publish on tag
│       ├── security.yml            ← weekly security scan
│       └── dependabot.yml          ← auto dependency updates
│
├── package.json
├── tsconfig.json
├── .eslintrc.json
├── .prettierrc
├── vitest.config.ts
└── refactron.yaml                  ← default config
```

---

## The Core Data Models — Lock These First

```typescript
// src/core/models.ts — LOCKED. Do not change after Day 2.

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type BlastLevel = 'trivial' | 'low' | 'medium' | 'high' | 'critical';

export interface BlastRadius {
  affectedFiles: string[];
  affectedFunctions: string[];
  affectedTestFiles: string[];
  score: number;              // 0–100
  level: BlastLevel;
}

export interface TemporalProfile {
  lastModified: Date;
  changeVelocity: number;     // changes per month (6-month window)
  coChangePairs: string[];    // files that always change with this one
  daysSinceLastTouch: number;
}

export interface CodeIssue {
  id: string;
  file: string;
  line: number;
  column?: number;
  severity: Severity;
  type: string;               // 'sql-injection', 'high-complexity', etc.
  message: string;
  suggestion?: string;
  fixable: boolean;
  fixerName?: string;
  blastRadius: BlastRadius;   // ALWAYS present — not optional
  temporal?: TemporalProfile; // present when git history available
  ruleId: string;
}

export interface VerificationResult {
  safeToApply: boolean;
  passed: boolean;
  checksRun: string[];
  checksPassed: string[];
  checksFailed: string[];
  blockingReason?: string;
  confidenceScore: number;    // 0.0–1.0
  verificationMs: number;
  skippedChecks: string[];
}

export interface CheckResult {
  passed: boolean;
  durationMs: number;
  blockingReason?: string;
  skippedReason?: string;
}

export interface AnalysisResult {
  target: string;
  filesAnalyzed: number;
  filesSkipped: number;
  issues: CodeIssue[];
  languageBreakdown: Record<string, number>;
  durationMs: number;
  timestamp: Date;
}

export type SessionState = 'ANALYZED' | 'FIXING' | 'FIXED' | 'ROLLED_BACK';
export type FixStatus = 'PENDING' | 'APPLIED' | 'BLOCKED' | 'SKIPPED';

export interface FixQueueItem {
  issueId: string;
  filePath: string;
  lineNumber: number;
  severity: Severity;
  message: string;
  fixerName: string;
  status: FixStatus;
  diff?: string;
  blockReason?: string;
  verificationResult?: VerificationResult;
}

export interface PipelineSession {
  sessionId: string;
  target: string;
  state: SessionState;
  totalFiles: number;
  totalIssues: number;
  issuesBySeverity: Record<Severity, number>;
  fixQueue: FixQueueItem[];
  appliedFixes: FixQueueItem[];
  blockedFixes: FixQueueItem[];
  backupSessionId?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

---

## The Language Adapter Interface — Lock This Second

```typescript
// src/adapters/interface.ts — LOCKED. Do not change after Day 2.

export interface TransformResult {
  transformedCode: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface ILanguageAdapter {

  // Identity
  readonly name: string;           // 'python', 'typescript', 'javascript'
  readonly extensions: string[];   // ['.py'], ['.ts', '.tsx']
  readonly displayName: string;    // 'Python', 'TypeScript'

  // Detection
  detect(projectRoot: string): Promise<boolean>;

  // Analysis
  analyze(files: string[]): Promise<CodeIssue[]>;

  // Transform (in memory — no write)
  transform(
    file: string,
    code: string,
    issue: CodeIssue
  ): Promise<TransformResult>;

  // Verification checks
  verifySyntax(path: string, code: string): Promise<CheckResult>;
  verifyImports(path: string, code: string): Promise<CheckResult>;
  verifyTests(path: string, code: string): Promise<CheckResult>;

  // Diff
  generateDiff(original: string, transformed: string): string;

  // Import graph (for blast radius + test gate)
  buildImportGraph(projectRoot: string): Promise<ImportGraph>;
  buildCallGraph(files: string[]): Promise<CallGraph>;
}
```

---

## The Blast Radius Engine — The New Thing

```typescript
// src/analysis/blast-radius.ts

export class BlastRadiusAnalyzer {

  constructor(
    private callGraph: CallGraph,
    private importGraph: ImportGraph
  ) {}

  compute(targetFile: string, targetFunction?: string): BlastRadius {

    // 1. Who imports this file directly?
    const directDependents = this.importGraph.dependentsOf(targetFile);

    // 2. Walk transitively — who imports those files?
    const visited = new Set<string>([targetFile]);
    const allDependents = this.walkTransitive(directDependents, visited);

    // 3. If function-level analysis — narrow to call graph
    const affectedFunctions = targetFunction
      ? this.callGraph.transitiveCallersOf(targetFile, targetFunction)
      : this.callGraph.allPublicFunctionsIn([...allDependents]);

    // 4. Test files only
    const affectedTestFiles = [...allDependents]
      .filter(f => this.isTestFile(f));

    // 5. Score 0–100
    const score = this.score(
      allDependents.size,
      affectedFunctions.length,
      affectedTestFiles.length
    );

    return {
      affectedFiles: [...allDependents],
      affectedFunctions,
      affectedTestFiles,
      score,
      level: this.levelFromScore(score),
    };
  }

  private score(files: number, fns: number, tests: number): number {
    // Weighted: files 40%, functions 40%, test coverage gap 20%
    const fileScore  = Math.min(files / 50, 1) * 40;
    const fnScore    = Math.min(fns / 100, 1) * 40;
    const testGap    = tests === 0 && files > 0 ? 20 : 0;
    return Math.round(fileScore + fnScore + testGap);
  }

  private levelFromScore(score: number): BlastLevel {
    if (score === 0)  return 'trivial';
    if (score < 20)   return 'low';
    if (score < 50)   return 'medium';
    if (score < 75)   return 'high';
    return 'critical';
  }
}
```

### Blast Radius Changes Verification Strictness

```typescript
// src/verification/engine.ts

async verify(
  originalPath: string,
  transformedCode: string,
  blastRadius: BlastRadius
): Promise<VerificationResult> {

  // High blast radius = stricter verification
  const checks = this.selectChecks(blastRadius);

  for (const check of checks) {
    const result = await check.run(originalPath, transformedCode);
    if (!result.passed) {
      return this.blocked(check.name, result.blockingReason!);
    }
  }

  return this.passed(checks);
}

private selectChecks(blast: BlastRadius): Check[] {
  if (blast.level === 'trivial') {
    return [this.syntaxCheck];                                  // fast path
  }
  if (blast.level === 'critical') {
    return [
      this.syntaxCheck,
      this.importCheck,
      this.testGate(120_000),   // 2min timeout for critical
    ];
  }
  return [this.syntaxCheck, this.importCheck, this.testGate()]; // standard
}
```

---

## The CLI — Ink-Based React Terminal UI

### The Fast-Path Dispatcher

```typescript
// src/cli/index.ts

const argv = process.argv.slice(2);
const cmd = argv[0];

// Fast paths — zero imports, <10ms
if (!cmd || cmd === '--version' || cmd === '-v') {
  process.stdout.write(require('../package.json').version + '\n');
  process.exit(0);
}

if (cmd === '--help' || cmd === '-h') {
  process.stdout.write(STATIC_HELP);
  process.exit(0);
}

// Full application load only when needed
const { run } = await import('./app');
await run(process.argv.slice(2));
```

### What the Terminal Looks Like

**Analysis output:**
```
  refactron analyze src/

  Detected  Python 3.11 · TypeScript 5.2
  Scanning  ████████████████████  47 files · 0.8s

  ─────────────────────────────────────────────────────────
  CRITICAL                                          2 issues
  ─────────────────────────────────────────────────────────

  SQL Injection                      src/api/views.py · line 47
  cursor.execute(f"SELECT * WHERE id={user_id}")
  → Parameterize this query
  Blast radius  ████████████████░░░░  23 files · CRITICAL
  [space to expand · f to fix · r to see radius graph]

  ─────────────────────────────────────────────────────────
  HIGH                                              7 issues
  ─────────────────────────────────────────────────────────

  ─────────────────────────────────────────────────────────
  3 critical · 7 high · 14 medium · 8 low · 9 autofixable
  Run: refactron autofix . --verify
```

**Verification output (pass):**
```
  refactron autofix src/api/views.py --verify

  Verifying  src/api/views.py
  ──────────────────────────────────────

  ✔  Syntax check         12ms
  ✔  Import integrity      8ms
  ✔  Tests passed          4 files · 6.2s

  Confidence     97%
  Blast radius   3 files  (was 23 — fix reduced scope)
  Status         Safe to apply

  Writing src/api/views.py ✔
```

**Verification output (blocked):**
```
  Verifying  src/payments/service.py
  ──────────────────────────────────────

  ✔  Syntax check         11ms
  ✔  Import integrity      9ms
  ✗  Tests FAILED

     test_payment_flow.py::test_refund
     AssertionError: expected 0, got -50

  Blocked — original file untouched
```

### Keyboard Navigation

```
analyze view:
  ↑ ↓      Navigate issues
  space    Expand / collapse issue
  f        Autofix current issue with verification
  F        Autofix all fixable issues
  d        Show diff preview
  r        Show blast radius graph
  q        Quit

autofix view:
  y        Confirm and apply
  n        Skip this fix
  d        Show diff
  r        Rollback last applied fix
  q        Quit
```

---

## The Temporal Safety Engine

```typescript
// src/analysis/temporal.ts

export class TemporalAnalyzer {

  async profile(filePath: string): Promise<TemporalProfile | null> {
    const isGitRepo = await this.detectGit();
    if (!isGitRepo) return null;

    const log = await this.gitLog(filePath, 180); // 6-month window
    if (log.length === 0) return null;

    const lastModified = log[0].date;
    const changeVelocity = log.length / 6;        // changes per month
    const daysSince = this.daysBetween(lastModified, new Date());
    const coChangePairs = await this.findCoChangePairs(filePath, log);

    return { lastModified, changeVelocity, coChangePairs, daysSinceLastTouch: daysSince };
  }

  private async gitLog(file: string, days: number) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const result = spawnSync('git', [
      'log', `--since=${since}`, '--format=%H %aI', '--', file
    ], { encoding: 'utf8' });
    return this.parseLog(result.stdout);
  }
}
```

**Risk scoring combining blast radius + temporal:**

```typescript
function computeRiskScore(issue: CodeIssue): string {
  const blast   = issue.blastRadius.score;
  const days    = issue.temporal?.daysSinceLastTouch ?? 0;
  const velocity = issue.temporal?.changeVelocity ?? 1;

  // High blast + stale + low velocity = maximum danger
  if (blast > 75 && days > 365 && velocity < 0.5) return 'DANGER';
  if (blast > 50 && days > 180) return 'HIGH';
  if (blast > 25) return 'MEDIUM';
  return 'LOW';
}
```

---

## GitHub CI/CD Workflows

### Workflow 1 — PR Checks (`ci.yml`)

Runs on every pull request and every push to main. Must pass before any merge.

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  typecheck:
    name: Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck

  lint:
    name: Lint + Format
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run format:check

  test:
    name: Tests (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: ['18', '20', '22']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: 'npm'
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install refactron pytest
      - run: npm ci
      - run: npm test -- --coverage
      - uses: codecov/codecov-action@v4
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
          fail_ci_if_error: true

  verification-gate:
    name: Verification Engine Gate
    runs-on: ubuntu-latest
    needs: [typecheck, lint, test]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install pytest
      - run: npm ci
      - run: npm run build
      # Run Refactron on itself — the self-analysis gate
      - run: node dist/cli/index.js analyze src/ --fail-on high
        name: Self-analysis gate
      # Run the known-bad transform test — must be blocked
      - run: npm run test:verification
        name: Verification blocks bad transforms

  build:
    name: Build Check
    runs-on: ubuntu-latest
    needs: [typecheck]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/
          retention-days: 7
```

### Workflow 2 — Release and npm Publish (`release.yml`)

Triggers when a version tag is pushed. Builds, tests, publishes to npm, creates GitHub release.

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*.*.*'

permissions:
  contents: write
  id-token: write   # for npm provenance

jobs:
  validate-tag:
    name: Validate Tag
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.tag.outputs.version }}
    steps:
      - uses: actions/checkout@v4
      - id: tag
        run: |
          TAG=${GITHUB_REF#refs/tags/v}
          PKG=$(node -p "require('./package.json').version")
          if [ "$TAG" != "$PKG" ]; then
            echo "Tag $TAG does not match package.json version $PKG"
            exit 1
          fi
          echo "version=$TAG" >> $GITHUB_OUTPUT

  test-before-release:
    name: Full Test Suite
    needs: validate-tag
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install pytest
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - run: node dist/cli/index.js --version

  publish-npm:
    name: Publish to npm
    needs: test-before-release
    runs-on: ubuntu-latest
    environment: npm-production
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm run build
      - run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

  github-release:
    name: Create GitHub Release
    needs: publish-npm
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Generate changelog
        id: changelog
        run: |
          PREV_TAG=$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo "")
          if [ -n "$PREV_TAG" ]; then
            LOG=$(git log $PREV_TAG..HEAD --pretty=format:"- %s" --no-merges)
          else
            LOG=$(git log --pretty=format:"- %s" --no-merges | head -20)
          fi
          echo "changelog<<EOF" >> $GITHUB_OUTPUT
          echo "$LOG" >> $GITHUB_OUTPUT
          echo "EOF" >> $GITHUB_OUTPUT
      - uses: softprops/action-gh-release@v2
        with:
          body: |
            ## What's Changed
            ${{ steps.changelog.outputs.changelog }}

            ## Install
            ```
            npm install -g refactron@${{ needs.validate-tag.outputs.version }}
            ```

            ## Full Changelog
            https://github.com/${{ github.repository }}/compare/...v${{ needs.validate-tag.outputs.version }}
          generate_release_notes: true
```

### Workflow 3 — Security Scanning (`security.yml`)

Runs weekly and on every push to main. Scans for vulnerabilities in dependencies and source.

```yaml
# .github/workflows/security.yml
name: Security

on:
  schedule:
    - cron: '0 9 * * 1'   # every Monday 9 AM UTC
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  dependency-audit:
    name: npm Audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm audit --audit-level=high
        # Fails if any HIGH or CRITICAL vulnerabilities found

  codeql:
    name: CodeQL Analysis
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      actions: read
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with:
          languages: typescript, javascript
          queries: security-extended
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci && npm run build
      - uses: github/codeql-action/analyze@v3
        with:
          category: '/language:typescript'

  self-analysis:
    name: Refactron Self-Analysis
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci && npm run build
      # Refactron analyzes its own source — zero tolerance for CRITICAL issues
      - run: |
          node dist/cli/index.js analyze src/ \
            --format json \
            --output analysis-report.json \
            --fail-on critical
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: self-analysis-report
          path: analysis-report.json
```

### Workflow 4 — Dependabot (`dependabot.yml`)

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
      day: monday
      time: '09:00'
    open-pull-requests-limit: 5
    groups:
      dev-dependencies:
        dependency-type: development
      production-dependencies:
        dependency-type: production
    labels:
      - dependencies
      - automated
    ignore:
      # Pin major versions manually
      - dependency-name: ink
        update-types: ['version-update:semver-major']
      - dependency-name: typescript
        update-types: ['version-update:semver-major']
```

### Workflow 5 — Nightly Regression (`nightly.yml`)

Runs every night on main. Tests against real open-source repos to catch regressions before users do.

```yaml
# .github/workflows/nightly.yml
name: Nightly Regression

on:
  schedule:
    - cron: '0 2 * * *'   # 2 AM UTC every night
  workflow_dispatch:

jobs:
  real-world-test:
    name: Real-world repo · ${{ matrix.repo }}
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        repo:
          - django/django
          - psf/requests
          - tiangolo/fastapi
          - psf/black
          - pallets/flask
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: npm ci && npm run build
      - name: Clone target repo
        run: git clone --depth=1 https://github.com/${{ matrix.repo }} /tmp/target
      - name: Run analysis — must not crash
        run: |
          node dist/cli/index.js analyze /tmp/target \
            --format json \
            --output /tmp/report.json \
            --timeout 120
      - name: Validate output schema
        run: node scripts/validate-report.js /tmp/report.json
      - name: Upload report
        uses: actions/upload-artifact@v4
        with:
          name: nightly-${{ matrix.repo }}-report
          path: /tmp/report.json
          retention-days: 30

  notify-on-failure:
    name: Notify on Failure
    needs: real-world-test
    if: failure()
    runs-on: ubuntu-latest
    steps:
      - name: Create GitHub Issue
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: `Nightly regression failure — ${new Date().toISOString().split('T')[0]}`,
              body: `The nightly real-world regression test failed.\n\nRun: ${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`,
              labels: ['bug', 'regression', 'automated']
            })
```

---

## The package.json — Production-Grade

```json
{
  "name": "refactron",
  "version": "2.0.0",
  "description": "Safety-first refactoring — finds, fixes, and verifies changes are safe before touching the filesystem",
  "bin": {
    "refactron": "./dist/cli/index.js"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc --project tsconfig.build.json",
    "build:watch": "tsc --project tsconfig.build.json --watch",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/ tests/ --ext .ts,.tsx --max-warnings 0",
    "format": "prettier --write src/ tests/",
    "format:check": "prettier --check src/ tests/",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:verification": "vitest run tests/verification/",
    "clean": "rimraf dist",
    "prepublishOnly": "npm run clean && npm run build && npm run typecheck && npm test"
  },
  "keywords": [
    "refactoring", "python", "typescript", "code-quality",
    "ast", "cli", "safety", "verification", "blast-radius"
  ],
  "engines": {
    "node": ">=18.0.0"
  },
  "files": [
    "dist/",
    "README.md",
    "LICENSE"
  ],
  "dependencies": {
    "ink": "^5.0.0",
    "react": "^18.0.0",
    "commander": "^12.0.0",
    "chalk": "^5.0.0",
    "tree-sitter": "^0.21.0",
    "tree-sitter-python": "^0.21.0",
    "tree-sitter-typescript": "^0.21.0",
    "js-yaml": "^4.0.0",
    "semver": "^7.0.0",
    "execa": "^8.0.0",
    "glob": "^10.0.0",
    "ink-spinner": "^5.0.0",
    "ink-table": "^3.0.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/node": "^20.0.0",
    "@types/react": "^18.0.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "eslint": "^8.0.0",
    "prettier": "^3.0.0",
    "vitest": "^1.0.0",
    "@vitest/coverage-v8": "^1.0.0",
    "rimraf": "^5.0.0"
  },
  "homepage": "https://refactron.dev",
  "repository": {
    "type": "git",
    "url": "https://github.com/refactron-ai/refactron"
  },
  "bugs": {
    "url": "https://github.com/refactron-ai/refactron/issues"
  },
  "license": "MIT"
}
```

---

## The tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "jsx": "react",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

---

## 8-Week Execution Plan

### Week 1 — Lock Contracts + Failing Test

**Goals:** Zero ambiguity about what every system produces and consumes. The failing test is the North Star for Weeks 2-4.

**Day 1:**
- Initialize npm workspace, install all dependencies
- Write `src/core/models.ts` — every interface and type
- Write `src/adapters/interface.ts` — ILanguageAdapter contract
- Review both files. If anything is wrong, fix it now. Not after Week 2.
- Commit: `feat: lock core models and adapter interface`

**Day 2:**
- Write `tests/verification/blocks-bad-transform.test.ts`
- This test MUST fail. It asserts that a known-bad transform is blocked.
- Write `tests/fixtures/python/bad-transform.py` — a function extraction that changes return type
- Write `tests/fixtures/python/safe-transform.py` — an unused import removal (trivially safe)
- Set up vitest, confirm the test runs and fails
- Commit: `test: add failing verification gate test`

**Day 3-4:**
- Set up GitHub repository, branch protection on main
- Write all five CI/CD workflow files
- Push — let CI run and show red (expected, nothing is built yet)
- Write `tsconfig.json`, `.eslintrc.json`, `.prettierrc`
- Set up Dependabot

**Day 5:**
- Write `src/core/config.ts` — RefactronConfig, YAML loader
- Write the project root detection logic
- Write `src/infrastructure/diff.ts` — unified diff generation
- Gate: `npm run typecheck` passes with zero errors

---

### Week 2 — Verification Engine

**Goals:** The verification engine works with mock adapters. The failing test from Week 1 must pass by end of Week 2.

**Day 6-7:**
- Write `src/verification/result.ts` — frozen dataclasses
- Write `src/verification/atomic-writer.ts` — temp file write + os.rename() + cleanup
- Write `src/verification/engine.ts` — orchestrator that calls adapter methods
- Write `src/verification/checks/syntax.ts` — delegates to adapter.verifySyntax()
- Write `src/verification/checks/imports.ts`
- Write `src/verification/checks/test-gate.ts` — with 45s hard kill

**Day 8-9:**
- Write a MockPythonAdapter that implements ILanguageAdapter
- Mock `verifySyntax()` to fail on the bad-transform fixture
- Wire mock adapter into verification engine
- Run the failing test — it should pass now
- Commit: `feat: verification engine with mock adapter — gate test passing`

**Day 10:**
- Write `src/infrastructure/backup.ts` — pre-write backup system
- Integration test: verify → pass → atomic write → file exists → rollback → original restored
- Gate: `blocks-bad-transform.test.ts` is GREEN. CI passes.

---

### Week 3 — Blast Radius + Analysis Engine

**Goals:** Every CodeIssue has a BlastRadius. Analysis runs on a real Python project.

**Day 11-12:**
- Write `src/analysis/import-graph.ts` — build reverse import graph from AST
- Write `src/analysis/call-graph.ts` — build function-level call graph
- Write `src/analysis/blast-radius.ts` — BlastRadiusAnalyzer
- Write `src/analysis/temporal.ts` — git log parsing, change velocity

**Day 13-14:**
- Write `src/analysis/engine.ts` — coordinates all analyzers
- Write all 7 analyzers in `src/analysis/analyzers/`
- Each analyzer uses tree-sitter for structural analysis + semgrep for rule-based patterns
- Every issue gets a BlastRadius before it leaves the analyzer

**Day 15:**
- Run analysis engine on `tests/fixtures/python/`
- Verify every CodeIssue has a non-null blastRadius
- Verify the SQL injection fixture gets a HIGH blast radius
- Verify the unused import fixture gets a TRIVIAL blast radius
- Gate: `npm test` passes. Analysis engine produces correct output on fixtures.

---

### Week 4 — Language Adapters

**Goals:** Python adapter replaces the mock. TypeScript adapter works end-to-end.

**Day 16-17:**
- Write `src/adapters/python/` — real Python adapter
- `verifySyntax()` — subprocess python3 -c "import ast; ast.parse(...)"
- `verifyImports()` — importlib.util.find_spec via subprocess
- `verifyTests()` — pytest subprocess with import-graph test selection
- Wire Python adapter into verification engine
- The blocks-bad-transform test now runs against the real Python adapter

**Day 18-19:**
- Write `src/adapters/typescript/`
- `verifySyntax()` — TypeScript compiler API
- `verifyImports()` — tsc --noEmit
- `verifyTests()` — jest/vitest detection + subprocess
- Write `src/adapters/registry.ts` — auto-detect language from file extension and config files

**Day 20:**
- Run on a real TypeScript project (the Refactron source itself)
- Gate: `node dist/cli/index.js analyze src/` on Refactron's own TypeScript source produces valid output with no crashes

---

### Week 5 — AutoFix Engine + Pipeline

**Goals:** The full analyze → fix → verify → write pipeline works end-to-end.

**Day 21-22:**
- Write `src/autofix/engine.ts` — AutoFixEngine with can_fix() and fix_file()
- Write all 14 fixers in `src/autofix/fixers/`
- Each fixer is tested against the corresponding fixture file

**Day 23-24:**
- Write `src/pipeline/session.ts` — state machine
- Write `src/pipeline/store.ts` — SessionStore reads/writes `.refactron/sessions/`
- Write `src/pipeline/queue.ts` — FixQueue, FixQueueItem
- Write `src/core/orchestrator.ts` — coordinates the full pipeline

**Day 25:**
- Integration test: analyze → queue issues → autofix with verify → check files written
- Gate: `refactron analyze . && refactron autofix . --verify` on fixture project completes without crashes. Known-safe transforms are applied. Known-bad transforms are blocked.

---

### Week 6 — CLI (Ink)

**Goals:** Beautiful terminal output matching the Claude Code reference.

**Day 26-27:**
- Write `src/cli/index.ts` — fast-path dispatcher
- Write `src/ui/theme.ts` — navy/blue palette
- Write `src/ui/StatusBar.tsx` — always-visible bottom bar
- Write `src/ui/ProgressBar.tsx` — animated scan progress

**Day 28-29:**
- Write `src/ui/IssueList.tsx` — virtual scrolling, keyboard navigation
- Write `src/ui/IssueDetail.tsx` — expanded issue with blast radius bar
- Write `src/ui/VerificationView.tsx` — live check-by-check progress
- Write `src/ui/DiffView.tsx` — syntax-highlighted diff
- Write `src/ui/BlastRadiusGraph.tsx` — ASCII blast radius visualization

**Day 30:**
- Wire all 6 commands to the engine through Ink views
- Gate: `refactron analyze .` on Refactron's own source produces beautiful, navigable output. Keyboard navigation works. No visual glitches.

---

### Week 7 — Real-World Testing

**Goals:** Zero crashes on 5 real repos. Self-analysis gate passes.

**Day 31-32:**
- Run on Django (Python, 300k+ lines)
- Run on Next.js (TypeScript, 50k+ lines)
- Fix every crash found

**Day 33-34:**
- Run on Requests, Flask, FastAPI
- Fix every edge case found
- Verify blast radius scores look reasonable on real codebases
- Verify temporal analysis works on repos with long git history

**Day 35:**
- Run `refactron analyze src/` on Refactron itself — the self-analysis gate
- Ensure zero CRITICAL issues in Refactron's own codebase before ship
- Gate: All 5 real repos analyzed without crash. Self-analysis returns zero CRITICAL.

---

### Week 8 — External Validation + npm Publish

**Goals:** 3 of 5 external developers say "I would use this on my real codebase."

**Day 36-37:**
- Find 5 senior engineers (Python or TypeScript, real legacy codebases)
- Install Refactron on their machines, watch them use it, say nothing

**Day 38-39:**
- Document every confusion point, every crash, every missing feature
- Fix the P0 issues (crashes, obviously wrong output)
- Add to BACKLOG.md: everything else

**Day 40:**
- Go/No-Go decision: 3 of 5 validated
- If GO: `git tag v2.0.0 && git push --tags` → CI publishes to npm automatically
- If NO-GO: fix the single most blocking issue, retest

---

## Branch Strategy

```
main          ← production. Protected. Only CI can merge.
develop       ← integration branch. PRs merge here first.
feat/*        ← feature branches off develop
fix/*         ← bug fix branches off develop
release/*     ← release prep branches (bump version, update changelog)
```

**Branch protection rules for `main`:**
- Require PR before merging
- Require all CI checks to pass
- Require at least 1 approving review
- Require branches to be up to date
- Restrict who can push directly (nobody)

**Release process:**
```bash
git checkout develop
git pull
git checkout -b release/2.0.0
# bump version in package.json
# update CHANGELOG.md
npm run build && npm test   # final local check
git commit -am "chore: release v2.0.0"
git push origin release/2.0.0
# Open PR: release/2.0.0 → main
# Merge PR → triggers release.yml → npm publish
git tag v2.0.0
git push --tags
```

---

## Gates Summary — No Phase Starts Until Its Gate Passes

| Week | Gate |
|---|---|
| 1 | `blocks-bad-transform.test.ts` fails as expected. CI workflows run. |
| 2 | `blocks-bad-transform.test.ts` is GREEN. CI passes. |
| 3 | Every CodeIssue has a BlastRadius. Analysis runs on fixtures without crash. |
| 4 | Python adapter replaces mock. TypeScript adapter works on TS source. |
| 5 | Full analyze → fix → verify → write pipeline works on fixture project. |
| 6 | `refactron analyze .` on Refactron source produces navigable output. |
| 7 | Zero crashes on 5 real repos. Self-analysis returns zero CRITICAL. |
| 8 | 3/5 external developers validate. npm publish triggered by tag. |

---

## What Is Not In This MVP

| Feature | Why Not | When |
|---|---|---|
| Pattern Learning | Needs real user data | v2.1 |
| RAG System | Needs real users | v2.1 |
| LLM Integration | Post-MVP intelligence layer | v2.2 |
| Semantic Duplication Detection | Phase 3 of analysis engine | v2.2 |
| Cascade Failure Prediction | Too complex for MVP | v3.0 |
| Prometheus / Telemetry | No users yet | v2.1 |
| Go / Rust / Java Adapters | TypeScript + Python first | v2.x |
| VSCode Extension | CLI must be perfect first | v3.0 |
| Parallel Analysis | Premature optimization | v2.1 |

---

*refactron.dev · pip install refactron · npm install -g refactron*
