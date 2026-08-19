# Refactron — Detailed Execution Plan v2.0

**Research-backed 8-week MVP shipping plan**
**Version:** 2.0 Final
**Date:** May 2026
**Founder:** Om Sherikar
**Stack:** TypeScript · npm (primary) · PyPI (legacy wrapper)
**Engines:** ts-morph · LibCST · tree-sitter · write-file-atomic
**License:** MIT

---

## What This Document Is

This is the locked execution plan for Refactron v2.0, built on a foundation of 33 years of academic research on behavior-preserving refactoring and 10+ years of industry precedent from Meta, Google, Instagram, and the open-source codemod ecosystem.

The plan is not aspirational. Every decision is grounded in cited research. Every week has a binary gate. Every transform has documented preconditions.

If something is not in this document, it is not in the MVP.

---

# Part 1 — Research Foundation

The case for building Refactron is built on five evidence-backed pillars.

## 1.1 The Academic Lineage

The intellectual core of Refactron — deterministic transformations that provably preserve behavior — has a 33-year academic lineage that the LLM-coding-tool market is ignoring.

**Opdyke 1992 (the foundational document).** William F. Opdyke's PhD thesis at UIUC, "Refactoring Object-Oriented Frameworks," defined refactoring as behavior-preserving program transformation. He introduced the critical concept that every refactoring has preconditions that must be checked before application. He defined seven properties: unique superclass, distinct class names, distinct member names, inherited member variables not redefined, compatible signatures, and proved that most low-level refactorings are trivially behavior-preserving while a few have undecidable preconditions in general — for which conservative algorithms suffice.

This document is the academic justification for Refactron's existence: safe refactoring requires checking preconditions, not pattern-matching token sequences.

**Roberts 1999 (practical analysis).** Don Roberts' PhD thesis "Practical Analysis for Refactoring" at UIUC extended Opdyke by automating low-level refactorings in the Smalltalk Refactoring Browser. Tokuda and Batory later showed Opdyke's preconditions alone were insufficient to guarantee behavior preservation for complex refactorings — a warning Refactron heeds by combining preconditions with test-gate verification.

**Mens and Tourwé 2002 (formalisation).** "Formalising Behaviour Preserving Program Transformations" in Springer LNCS introduced a graph-transformation formalism and remains the canonical reference for proving correctness of refactorings.

**Fowler 1999, 2018 (practitioner catalog).** Refactoring: Improving the Design of Existing Code is where the named transformations live: Extract Method, Inline Variable, Replace Conditional with Polymorphism. Refactron's transform catalog is anchored in this tradition.

**Letouzey 2012 (SQALE methodology).** The Software Quality Assessment based on Lifecycle Expectations model defines remediation cost in minutes/hours per quality violation, aggregated to a SQALE Index. ISO 9126-compliant. This is how SonarQube quantifies tech debt, and it is the correct model for Refactron's analysis output.

**Behavior preservation systematic review (arXiv:2106.13900).** A survey of 142 primary studies confirms behavior preservation remains an open problem. Most tools rely on testing as the empirical safety net rather than formal proof. This justifies Refactron's test-suite gate as the right approach.

**Wang et al. 2018 (test selection).** ICSE 2018 paper "Towards Refactoring-Aware Regression Test Selection" found empirically that only 22 percent of refactored methods and fields are covered by existing regression tests, yet refactorings are involved in nearly half of failed test cases. Implication: do not blindly trust the existing test suite as a complete oracle. Refactron must report coverage of the changed surface so users can make informed decisions.

**Mongiovi et al. 2014 (impact analysis).** Science of Computer Programming paper "Making Refactoring Safer Through Impact Analysis" is the canonical reference for designing Refactron's dependency-graph step.

**Brunsfeld 2018 (tree-sitter).** Max Brunsfeld's Strange Loop talk "Tree-sitter: a new parsing system for programming tools" is the engineering rationale. Tree-sitter offers a uniform C API, incremental parsing, robust error recovery on incomplete code, and a built-in S-expression query system. Tree-sitter is the right parser for Refactron's analysis step because it handles partially-broken legacy code without crashing.

## 1.2 Industry Precedents

The pattern Refactron is implementing has been validated at scale by every major engineering organization.

**Meta and jscodeshift.** Created at Facebook in 2015, jscodeshift was used internally for thousands of React migrations. Built on recast (format-preserving) and ast-types (AST traversal/manipulation), parses with Babel/Babylon/Flow/TS. The critical lesson: jscodeshift was abandoned by Meta in 2024. Issue #587 confirms there are currently no active maintainers at Meta. Maintenance handed to the Codemod team. The 9-year gap between v0.x and v17.0.0 is significant.

There is a real market gap for a maintained, opinionated, safety-first successor.

**Google and ClangMR.** The ICSME 2013 paper "Large-Scale Automated Refactoring Using ClangMR" combines the Clang compiler framework with MapReduce to refactor Google's C++ codebase at scale. The paper notes that automatically finding and transforming code in a semantically correct way can be challenging, particularly as the size of a codebase increases. Google chose semantic, type-attributed transformation over text-based find/replace. This is the precedent for OpenRewrite's LST design and validates Refactron's commitment to AST-based deterministic transforms.

**Instagram and LibCST.** Python's standard ast module is lossy — it drops comments, parens, whitespace — so codemods that re-emit code mangle formatting. LibCST is a Concrete Syntax Tree that preserves all formatting details while exposing AST-like semantics. Built on top of Guido van Rossum's pgen2 and David Halter's parso. Ships with codemods including ConvertFormatStringCommand which converts .format() to f-strings — exactly one of Refactron's planned transforms.

This is Refactron's reference implementation. Do not reinvent it.

**OpenRewrite by Moderne.** The gold-standard large-scale automated refactoring framework. The key concept is the Lossless Semantic Tree: type-attributed and format-preserving. Every node carries fully-qualified type info, even for types defined in transitive dependencies. 5,000+ community recipes. Recipes are deterministic programs that navigate the LST — exactly Refactron's positioning.

**Semgrep autofix.** Semgrep's blog post "Powerfully autofixing code with Semgrep's new AST-based approach" reports AST-based autofix succeeds in 96.4 percent of Python test cases and 100.0 percent of JavaScript test cases from semgrep-rules. The lesson: deterministic AST refactoring at high accuracy is achievable if scope is tight.

**GitHub and tree-sitter.** Brunsfeld's tree-sitter now powers in-browser symbolic code navigation on GitHub.com. Bindings exist for Go, Haskell, Java, JS, Kotlin, Python, Ruby, Rust, Swift, Zig. This is the production-grade foundation Refactron's analysis layer rests on.

## 1.3 The LLM Failure Data

The case for the no-LLM refactoring engine is built on hard numbers.

**NYU 2022 study of 1,692 Copilot programs.** Approximately 40 percent contained exploitable security vulnerabilities. C code showed approximately 50 percent vulnerability rates. Python 39 percent. Java 72 percent, with XSS failing 86 percent of the time.

**ACM AST 2024 study on Copilot test generation.** When generating tests with Copilot without an existing test suite, 92.45 percent of the tests are failing, broken, or empty.

**UTSA, Virginia Tech, University of Oklahoma joint study.** 16 LLMs, 576,000 code samples. 19.7 percent of recommended packages were fabricated and non-existent — 205,000 hallucinated packages. 58 percent repeated across queries, enabling supply-chain attacks now called slopsquatting.

**Liu et al. 2024 (arXiv:2404.00971).** "Beyond Functional Correctness: Exploring Hallucinations in LLM-Generated Code" provides a taxonomy of code hallucinations across CodeGen, CodeRL, Codex, ChatGPT. Confirms hallucination is structural, not accidental.

These five numbers are the entire pitch:

```
40% of Copilot programs contain security vulnerabilities
92% of Copilot-generated tests are broken
20% of recommended packages don't exist
33% of dev time is spent on tech debt
62% of developers cite tech debt as their #1 frustration
```

## 1.4 Market Validation

**Stripe and Harris Poll 2018, "The Developer Coefficient."** Developers spend 17.3 hours per week on maintenance — dealing with bad code, debugging, refactoring — versus 41.1 hours total. That is 42 percent of work time on tech debt. 13.5 hours on tech debt specifically. Bad code costs companies $85 billion annually. Tech debt has a $3 trillion impact on global GDP over 10 years.

**Stack Overflow 2024 Developer Survey.** 65,000+ respondents from 185 countries. Technical debt is the number one frustration for 62 percent of professional developers, twice the rate of the number two and number three frustrations. Improving code quality is the number one source of satisfaction across all developer segments.

Translation: developers actively want to pay down debt but lack tools that let them do it safely.

That gap is Refactron's wedge.

## 1.5 Competitive Landscape

| Tool | Approach | Verifies before write | Deterministic | Multi-language refactors |
|---|---|---|---|---|
| Cursor, Copilot, Continue | LLM completion in IDE | No | No | Suggests, does not refactor codebase |
| SonarQube, CodeAnt | Static analysis / linter | N/A reports only | Yes | No autofix at refactor depth |
| Greptile, Patched | LLM code review | No | No | No |
| jscodeshift | AST codemod | No (codemod author's job) | Yes | JS/TS only, unmaintained |
| LibCST codemods | CST codemod | No | Yes | Python only |
| OpenRewrite | LST recipes | Has build-plugin tests | Yes | Mostly Java |
| Semgrep autofix | Pattern + autofix | No | Yes (96–100% expressions) | Polyglot but shallow |
| Comby | Structural search/replace | No | Yes | Polyglot, no type info |
| Evōk Labs | Deterministic engine | Claimed | Claimed | Unknown — pre-product |
| Refactron | AST transform + 3-gate verify | Yes (syntax + imports + tests) | Yes | Python + TS |

The gap is precisely where Refactron sits: a maintained, opinionated, multi-language deterministic refactoring CLI with mandatory pre-write verification.

---

# Part 2 — The Product Identity (Locked)

## The One Sentence

Refactron finds legacy code and technical debt in production codebases, refactors it to modern solutions, and proves nothing broke before touching a single file.

## What Refactron Is Not

Refactron is not a linter. Not a formatter. Not a prettifier. Not an AI assistant. Does not suggest. Does not flag. Refactors.

## The Four Step Pipeline

```
Step 1 — DEEP ANALYSIS
  Scans the full dependency graph.
  Detects legacy patterns, deprecated APIs, technical debt.
  SQALE-style remediation cost per finding.
  Read-only. Nothing is touched.

Step 2 — REFACTORING ENGINE (the moat)
  Deterministic, rule-based AST transforms.
  No LLM. Same input → same output, every time.
  10 transforms at launch (5 Python + 5 TypeScript).
  Built on ts-morph + LibCST.

Step 3 — VERIFICATION ENGINE
  Three gates before any file is written:
    Gate 1: Syntax validity (re-parse)
    Gate 2: Import integrity (resolution check)
    Gate 3: Test suite (subprocess on shadow tree)
  All must pass. If any fail, original is never touched.
  Atomic write via write-file-atomic.

Step 4 — DOCUMENTATION ENGINE
  ONLY step using LLM.
  Generates docstrings, inline comments, changelogs.
  Runs ONLY on already-verified refactors.
  LLM never touches code itself.
```

---

# Part 3 — The Ten Refactor Transforms

Ten transforms at launch. No more. Each has documented preconditions per Opdyke's framework.

## Python Transforms

**Transform 1: callback_to_async_await**

Detects: functions with callback parameters where callback is the last param named callback/cb/done and called inside body.

Preconditions:
- Callback called exactly once at the end of all branches
- No other use of asyncio in conflict
- Function is not a generator

Implementation: LibCST Transformer that converts `def f(..., callback): ... callback(result)` to `async def f(...): ... return result` and rewrites all call sites with `await`.

Hardest of the 10. Start here so the rest feel easy.

**Transform 2: format_to_fstring**

Detects: % formatting and .format() calls.

Implementation: Ship LibCST's ConvertFormatStringCommand as-is. MIT licensed, already excellent. Do not rewrite. Document the dependency.

**Transform 3: manual_typecheck_to_hints**

Detects: isinstance chains that effectively type-discriminate parameters.

Implementation: Add `param: Union[A, B]` annotation. Conservative — only when the chain dispatches the whole function body.

**Transform 4: deprecated_api (requests → httpx)**

Detects: requests library imports and call patterns.

Implementation: Hardcoded mapping. Import rewrite plus call-site rewrite. Each entry includes a regression test fixture.

Start with requests → httpx only. Highest-value, highest-confidence. Document urllib2 → urllib.request, optparse → argparse as roadmap.

**Transform 5: class_to_dataclass**

Detects: classes whose __init__ is purely self.x = x assignment.

Preconditions:
- No other methods touch __init__
- No __slots__
- No inheritance with custom __init__

Implementation: Rewrite to @dataclass with field annotations from inferred types or explicit annotations.

## TypeScript Transforms

**Transform 6: var_to_const_let**

Detects: any var declaration.

Implementation: For each var, run mutability check. If reassigned → let. Else → const.

Preconditions:
- Not in a with statement
- No hoisting reliance (detect via use-before-declaration in source-order traversal)

**Transform 7: promise_chains_to_async**

Detects: .then().then() chains where the enclosing function can be made async.

Implementation: Convert `a.then(b).then(c)` to `const x = await a; const y = await b(x); return await c(y);`

Preconditions:
- No Promise.all/race inside chain
- No error-only .catch that needs special handling (when present, wrap in try/catch)

**Transform 8: implicit_any**

Detects: parameters/return types where ts-morph getType().isAny() is true.

Implementation: Try inference from call sites via getReferencingNodes(). If all call sites pass the same primitive type, annotate.

Conservative. Annotate only when confidence is high.

**Transform 9: commonjs_to_esm**

Detects: require() calls, module.exports assignments.

Implementation:
- `const x = require('y')` → `import x from 'y'`
- `module.exports = x` → `export default x`
- `module.exports = { a, b }` → `export { a, b }`

Preconditions:
- File is not a .cjs
- package.json's "type": "module" is set or being set in same plan
- No dynamic require()
- No __dirname/__filename (these break under ESM, document and skip)

**Transform 10: promise_constructor_to_async**

Detects: new Promise((resolve, reject) => { ... }) where body has simple shape.

Preconditions:
- No setTimeout/event-listener escape
- No resolve called multiple times
- Single resolve/reject path

Implementation: Rewrite to an async function.

Hardest TS transform.

---

# Part 4 — Project Architecture

## The Locked Contracts

Written on Day 1. Frozen on Day 2. Never change after that.

```typescript
// src/contracts.ts — LOCKED

export interface Analyzer {
  analyze(root: string): Promise<AnalysisReport>;
}

export interface Refactorer {
  plan(report: AnalysisReport, transforms: TransformId[]): Promise<RefactorPlan>;
}

export interface Verifier {
  verify(plan: RefactorPlan): Promise<VerificationResult>;
}

export interface Documenter {
  document(verified: VerificationResult): Promise<DocPatch>;
}

export interface RefactorPlan {
  changes: FileChange[];
  preconditions: Precondition[];
}

export interface FileChange {
  path: string;
  oldHash: string;
  newContent: string;
  transformId: TransformId;
}

export interface VerificationResult {
  passed: boolean;
  gates: {
    syntax: GateResult;
    imports: GateResult;
    tests: GateResult;
  };
  writableChanges: FileChange[];
}

export interface GateResult {
  passed: boolean;
  durationMs: number;
  blockingReason?: string;
}

export type TransformId =
  | 'callback_to_async_await'
  | 'format_to_fstring'
  | 'manual_typecheck_to_hints'
  | 'deprecated_api_requests_to_httpx'
  | 'class_to_dataclass'
  | 'var_to_const_let'
  | 'promise_chains_to_async'
  | 'implicit_any'
  | 'commonjs_to_esm'
  | 'promise_constructor_to_async';
```

## Tech Stack Decisions (Cited)

| Choice | Rationale | Source |
|---|---|---|
| ts-morph for TS | Wraps TS Compiler API with full type info, actively maintained by David Sherret | ts-morph.com |
| LibCST for Python | Lossless CST, preserves formatting, mature codemod tooling, includes ConvertFormatStringCommand | Instagram engineering |
| tree-sitter for analysis | Incremental, error-recovering, multi-language, robust on broken code | Brunsfeld Strange Loop 2018 |
| write-file-atomic for writes | Maintained by npm team, handles POSIX rename + Windows MoveFileExW | github.com/npm/write-file-atomic |
| pnpm workspace | Faster than npm, better monorepo support | pnpm.io |
| tsup for bundling | esbuild-based, simple config | github.com/egoist/tsup |
| Biome for lint/format | Replaces ESLint + Prettier, unified, faster | biomejs.dev |
| Vitest for tests | Native TS, fast, vite-aligned | vitest.dev |

## Project Structure

> **Note (Week 5 direction).** The pre-existing Ink-based TUI under `src/cli/app.tsx` + `src/cli/REPL.tsx` + `src/cli/runner.ts` + `src/ui/*` is **preserved and reused**, not retired. Week 5 reroutes the existing REPL handlers from the legacy `Orchestrator` to the v2 engines (`RefactronAnalyzer`, the Week-4 `Refactorer`, `RefactronVerifier`, the Week-6 `Documenter`). The OAuth device flow under `src/auth/` stays in place. **Auth is required for every v2 command, every invocation — including one-shot CLI use from CI.** Both surfaces (interactive TUI and one-shot CLI via `--json` / `--no-tui` / non-TTY) load credentials from `~/.refactron/credentials.json` OR the `REFACTRON_TOKEN` env var; missing/expired token is a hard error before any engine runs. CI users authenticate once locally and inject the token into runners as a secret.

```
refactron/
├── src/
│   ├── contracts.ts                  ← LOCKED Day 1
│   ├── cli/
│   │   ├── index.ts                  ← entry, fast-path dispatcher (one-shot CLI vs TUI)
│   │   ├── app.tsx                   ← TUI boot: config + adapter detect + login + REPL mount (kept)
│   │   ├── REPL.tsx                  ← interactive REPL (kept)
│   │   ├── runner.ts                 ← REPL command dispatch — Week 5 reroutes to v2 engines
│   │   ├── analyze-command.ts        ← one-shot `refactron analyze` (Week 3)
│   │   └── commands/                 ← Ink command components (kept; Week 5 swaps engines underneath)
│   │       ├── analyze.tsx
│   │       ├── run.tsx               ← added Week 5 (calls Week-4 transforms + verify + atomic write)
│   │       ├── document.tsx          ← added Week 6
│   │       └── init.tsx              ← added Week 5
│   │
│   ├── auth/                         ← OAuth device flow against api.refactron.dev (kept)
│   ├── ui/                           ← Ink component library — IssueBrowser, DiffView, etc. (kept; Week 5 reshapes IssueBrowser to consume v2 Findings)
│   ├── session/                      ← WorkSession persistence (kept; Week 5 stores v2 Findings instead of legacy CodeIssue)
│   │
│   ├── analyze/
│   │   ├── discovery.ts              ← file walk, gitignore
│   │   ├── parser.ts                 ← tree-sitter pipeline
│   │   ├── graphs/
│   │   │   ├── import-graph.ts
│   │   │   └── call-graph.ts
│   │   ├── detectors/
│   │   │   ├── python/
│   │   │   │   ├── callback-pattern.ts
│   │   │   │   ├── old-string-format.ts
│   │   │   │   ├── manual-typecheck.ts
│   │   │   │   ├── deprecated-api.ts
│   │   │   │   └── class-init-only.ts
│   │   │   └── typescript/
│   │   │       ├── var-declarations.ts
│   │   │       ├── promise-chains.ts
│   │   │       ├── implicit-any.ts
│   │   │       ├── commonjs.ts
│   │   │       └── promise-constructor.ts
│   │   └── sqale.ts                  ← remediation cost model
│   │
│   ├── transform/
│   │   ├── engine.ts
│   │   └── transforms/
│   │       ├── python/               ← 5 transform files
│   │       └── typescript/           ← 5 transform files
│   │
│   ├── verify/
│   │   ├── engine.ts
│   │   ├── syntax.ts                 ← Gate 1
│   │   ├── imports.ts                ← Gate 2
│   │   ├── tests.ts                  ← Gate 3
│   │   └── shadow-tree.ts            ← copy-on-write fs
│   │
│   ├── write/
│   │   └── atomic.ts                 ← write-file-atomic wrapper
│   │
│   ├── document/
│   │   ├── engine.ts
│   │   ├── providers/
│   │   │   ├── openai.ts
│   │   │   ├── anthropic.ts
│   │   │   └── ollama.ts             ← local, default
│   │   └── templates.ts
│   │
│   └── adapters/
│       ├── interface.ts
│       ├── registry.ts
│       ├── python.ts
│       └── typescript.ts
│
├── tests/
│   ├── e2e/
│   │   └── golden.test.ts            ← the failing test, Week 1
│   ├── fixtures/
│   │   ├── python-legacy-mini/
│   │   └── ts-legacy-mini/
│   └── unit/
│
├── .github/workflows/
│   ├── ci.yml
│   ├── release.yml
│   ├── security.yml
│   └── nightly.yml
│
├── package.json
├── tsconfig.json
├── biome.json
└── vitest.config.ts
```

---

# Part 5 — The 8-Week Build Plan

Each week ends with a binary gate. If you cannot tick it Friday EOD, you do not start the next week. You finish what you started or you cut scope.

## Week 1 — Lock Contracts + Failing Test

**Goal:** Define every interface. Write the one end-to-end test the entire MVP is engineered to pass. Ship nothing else.

**Why this week exists:** Solo founders die from scope creep. Locking contracts on Day 1 means Week 2's code cannot drift from Week 4's expectations. Test-first is non-negotiable because Refactron's whole pitch is verify before write — you cannot ship that if your own test suite is theater.

**Day-by-day:**

Day 1 (Monday): Write the one-page PRD. Frozen. Print it. Tape it to the wall. Audience: solo Python/TS dev with a 10k–500k LOC legacy codebase, no LLM tools allowed.

Day 2 (Tuesday): Define the four engine interfaces in TypeScript. No implementations. The contracts file from Part 4 of this plan, frozen.

Day 3 (Wednesday): Build the fixture repos. `fixtures/python-legacy-mini/` and `fixtures/ts-legacy-mini/` — each approximately 10 files, with one of each transform pattern present, and a passing pytest/vitest suite. This is your golden reference.

Day 4 (Thursday): Write `tests/e2e/golden.test.ts` — the failing test:

```typescript
test('refactron run --apply produces verified, behavior-preserving output', async () => {
  const before = snapshot('fixtures/python-legacy-mini');
  await execa('refactron', ['run', '--apply', '--transforms=all', fixturePath]);
  const after = snapshot(fixturePath);
  expect(after.testsStillPass).toBe(true);          // test gate
  expect(after.syntaxValid).toBe(true);             // syntax gate
  expect(after.importsResolve).toBe(true);          // import gate
  expect(diffLines(before, after)).toMatchSnapshot(); // deterministic
});
```

Day 5 (Friday): Repo skeleton. pnpm monorepo. tsup for bundling. Biome for lint/format. Vitest for tests. GitHub Actions CI runs lint plus the failing e2e test which must fail. Open public GitHub repo with README saying "alpha — do not use."

Day 6–7 (Weekend): Decision memo. ts-morph (chosen) versus babel/recast for TS. LibCST (chosen) versus RedBaron/parso for Python. Document rationale citing ts-morph docs, Instagram engineering's LibCST blog, and Adam Stepinski's "Refactoring a Python Codebase with LibCST" piece.

**Binary gate:** `pnpm test` shows exactly one e2e test failing for the right reason. CI is green-on-fail. No other code in src/ except the contract interfaces.

**Risks:**
- Over-designing interfaces. Mitigation: limit to about 50 lines of contracts.ts.
- Picking wrong AST library. Mitigation: Day 6–7 memo includes a 1-hour spike on each.
- Fixture too synthetic. Mitigation: base fixtures on real-world snippets — Django views with callbacks, Express routes with promise chains.

## Week 2 — Verification Engine

**Goal:** Build the three-gate Verification Engine before building anything to verify. Counterintuitive but correct: the moat is deterministic plus verified. Without verification the moat is just deterministic, which Babel already offers.

**Why this week exists:** Verification before write is the differentiator. If you build the Refactoring Engine first, you will be tempted to ship without verification when the deadline approaches. Building verification first makes it structurally impossible to ship without it.

**Day-by-day:**

Day 8 (Monday): Implement Gate 1 — Syntax. Python: re-parse with LibCST. If it raises ParserSyntaxError, gate fails. TypeScript: ts-morph project.getPreEmitDiagnostics() filtered to syntax errors. Gate must run on the proposed new content in memory, never on disk.

Day 9 (Tuesday): Implement Gate 2 — Import Integrity. Build dependency graph from proposed-new-content trees. Python: collect all import and from-import statements, resolve against sys.path and file tree. TS: ts-morph sourceFile.getImportDeclarations() plus getModuleSpecifierSourceFile() resolution. Fail if any newly-introduced import does not resolve OR any previously-resolving import in a changed file now fails. Cite OpenRewrite's type-attributed LST motivation here.

Day 10 (Wednesday): Implement Gate 3 — Test Suite. This is the hardest gate.

Shadow tree: temp directory copy of project, populated via copy-on-write (hardlinks where possible) of unchanged files, fresh writes of changed files. Use Node's fs.cp with recursive: true and hardlink mode where available.

Run project's test command in the shadow tree as subprocess: child_process.spawn with detached: false, timeout default 600s, resource limits via ulimit -v on Linux. Parse exit code, stdout, stderr.

Critical: run test command on unmodified shadow tree first to establish baseline. If baseline already fails, abort with "your tests don't pass before refactoring — fix that first." Brutal but correct.

Cite Wang et al. ICSE 2018: only 22% of refactored code is covered by tests. Report coverage of the changed surface to inform the user.

Day 11 (Thursday): Implement atomic write. Use write-file-atomic directly. Do not reinvent. Wrap in BatchAtomicWriter that either writes all FileChanges or rolls back none. Collect all temp paths, fsync all, rename all. On any rename failure, unlink remaining temps.

Day 12 (Friday): Write unit and integration tests for all three gates. Property-based testing for syntax gate. Hand-curate approximately 30 syntax-break cases. For test gate, mock subprocesses with stubs.

Day 13–14 (Weekend): Buffer for gate work that will take longer than expected. Specifically the test gate — running subprocesses cleanly is fiddly. If still stuck Sunday EOD, time-box and document a known-limitation.

**Binary gate:** Given a hand-crafted broken RefactorPlan (syntax error / unresolved import / failing test), each of the three gates rejects it with a specific error message. Given a hand-crafted valid plan, all three gates pass and the atomic write succeeds.

**Risks:**
- Subprocess management is a swamp. Mitigation: limit to npm test, pytest, vitest, jest runners detected by config-file presence. Document supported runners. Ship `--test-cmd` override.
- Shadow-tree copy slow on large repos. Mitigation: hardlink unchanged files. Benchmark on 50k-file fixture before Week 7.
- Flaky tests. Mitigation: run baseline up to 3 times before declaring failure. Document flakiness mode.

## Week 3 — Deep Analysis Engine

**Goal:** Scan a codebase, build dependency plus call graphs, detect legacy patterns, produce SQALE-style remediation-cost report. Read-only. Writes nothing.

**Why this week exists:** Without analysis you cannot show users what is wrong before asking them to trust you to fix it. Analysis is also your first user value — even users who never run --apply will run refactron analyze.

**Day-by-day:**

Day 15 (Monday): File discovery plus language detection. Walk directory, respect .gitignore using ignore npm package. Classify files as .py / .ts / .js / .tsx. Reject binaries, vendored dirs (node_modules, .venv, dist, build).

Day 16 (Tuesday): Parsing pipeline. Tree-sitter for fast first-pass scan — incremental, error-recovering, robust on broken code per Brunsfeld 2018. ts-morph and LibCST for precise second pass on files flagged for transformation. Two-pass design because tree-sitter is fast and tolerant; ts-morph/LibCST give you types.

Day 17 (Wednesday): Python pattern detectors. One per planned transform, returning structured findings:
- detect_callback_to_async: confidence score based on usage pattern
- detect_old_string_formatting: % and .format() detection
- detect_manual_type_checking: isinstance chains that could be type hints
- detect_deprecated_api: hardcoded mapping requests → httpx
- detect_class_to_dataclass: classes with __init__ only assigning self.x = x

Day 18 (Thursday): TS pattern detectors:
- detect_var_to_const_let: any var with mutability analysis
- detect_promise_chains: .then().then() chains
- detect_implicit_any: parameters/returns without type annotations
- detect_commonjs: require() and module.exports
- detect_promise_constructor: new Promise simple patterns

Day 19 (Friday): Graph construction. Dependency graph (imports → files). Call graph (functions → functions called). Python: LibCST MetadataWrapper with ScopeProvider. TS: ts-morph getReferences() plus findReferences(). Output graph as adjacency list. Expose `refactron analyze --graph=deps.json`.

Cite Pradel and Sen ISSTA 2015 on bad coding practices and the static analysis tradition for graph construction. Static graphs are conservative over-approximations — document this honestly.

Day 20–21 (Weekend): SQALE-style cost report per Letouzey 2012. Each finding has remediationMinutes field calibrated empirically:
- callback-to-async: 5 min/instance + 2 min/call site
- var-to-const: 1 min
- promise-chain-to-async: 3 min/chain
- commonjs-to-esm: 2 min/file
- And so on

Sum into refactron analyze pretty CLI output using cli-table3 and chalk. Output JSON via --json for CI integration.

**Binary gate:** `refactron analyze fixtures/python-legacy-mini` and `refactron analyze fixtures/ts-legacy-mini` both run in under 5 seconds and detect every pre-seeded pattern. Zero false negatives on fixtures.

**Risks:**
- False positives flood the user. Mitigation: every detector has a confidence field (high/medium/low). CLI defaults to `--confidence=high`.
- Call graph unsound for dynamic dispatch. Mitigation: document explicitly that call graph is may-call not must-call. Do not use it for behavior preservation, only for impact warnings.

## Week 4 — Refactoring Engine: The Moat

**Goal:** Implement all 10 deterministic, rule-based, no-LLM transforms with full preconditions. This is the week your competitive moat is forged.

**Why this week exists:** This is the work no LLM tool wants to do. Every transform is a domain-specific compiler pass with hand-curated preconditions per Opdyke 1992. Doing this correctly across 10 transforms is the entire defensibility story.

**Day-by-day:**

Day 22 (Monday): Python Transform 1 — callback_to_async_await. The hardest of the 10. Start here so the rest feel easy. Full preconditions per Part 3 of this plan.

Day 23 (Tuesday): Python Transforms 2 and 3.
- format_to_fstring: ship LibCST's ConvertFormatStringCommand as-is, MIT licensed, already excellent. Document the dependency.
- manual_typecheck_to_hints: detect isinstance chains that effectively type-discriminate parameters. Conservative — only when the chain dispatches the whole function body.

Day 24 (Wednesday): Python Transforms 4 and 5.
- deprecated_api: start with requests → httpx only. Highest-value, highest-confidence. Include import rewrite plus call-site rewrite plus regression test fixture. Document urllib2 → urllib.request, optparse → argparse as roadmap.
- class_to_dataclass: detect classes whose __init__ is purely self.x = x assignment. Rewrite to @dataclass with field annotations.

Day 25 (Thursday): TS Transforms 6 and 7.
- var_to_const_let: ts-morph traversal. For each var, run mutability check. If reassigned → let. Else → const.
- promise_chains_to_async: convert .then chains to const/await pattern. When .catch present, wrap in try/catch.

Day 26 (Friday): TS Transforms 8 and 9.
- implicit_any: find parameters/returns where getType().isAny() is true. Try inference from call sites. If all call sites pass the same primitive type, annotate.
- commonjs_to_esm: require → import. module.exports → export. Skip files using __dirname/__filename.

Day 27 (Saturday): TS Transform 10 — promise_constructor_to_async. Hardest TS transform. Preconditions per Part 3.

Day 28 (Sunday): Hardening day. For each of the 10 transforms — minimum 10 positive test fixtures, 5 negative (precondition fails), 3 edge case fixtures (decorators, generators, nested functions, default args, destructuring). Total target approximately 180 fixture tests. No transform ships without all three sets passing.

**Binary gate:** Every transform passes its full fixture suite. Every negative fixture is rejected at the precondition stage before the Verification Engine even runs. End-to-end test from Week 1 now passes for fixtures/python-legacy-mini repo end-to-end.

**Risks:**
- One transform turns out much harder than estimated. Likely candidates: callback-to-async, promise-constructor-to-async. Mitigation: cut scope to "supported subset" with explicit error message. Better to ship 8 perfect transforms than 10 buggy ones. Per Wang et al. ICSE 2018, a single buggy transform poisons trust permanently.
- Precondition logic accidentally accepts a behavior-changing case. Mitigation: Verification Engine catches this at the test-gate step — but only if user tests cover it. Add Refactron coverage warning output listing transforms that touched code with no test coverage.

## Week 5 — TUI Integration, Adapters, and Polish

**Goal:** Wire the v2.0 verbs (analyze, run, document, init) into the existing Ink-based TUI as first-class REPL commands. Retire the legacy blast-radius verbs from the REPL surface. Auth gate stays in front of every v2 verb. Tighten config, JSON output, dry-run, and cross-platform paths.

**Why this week exists:** The legacy product already ships a polished interactive TUI (`src/cli/app.tsx` → `<REPL>` → `<IssueBrowser>`) backed by an OAuth device flow against `api.refactron.dev`. Throwing it away is wasted leverage. The right move is to reroute the existing REPL handlers — currently calling `Orchestrator.analyze()` / `autofix()` / `verify()` against the legacy blast-radius engine — to call the new v2 engines (`RefactronAnalyzer`, the Week-4 `Refactorer`, the Week-2 `RefactronVerifier`, the Week-6 `Documenter`). The TUI shell, auth, and component library are reused; the engine wiring underneath is swapped.

This week also addresses the dual-product surface: keep the one-shot CLI path (`refactron analyze fixtures/...`) for CI/automation that should NOT enter the TUI or require login, AND keep the interactive TUI for human use that DOES require login.

**Day-by-day:**

Day 29 (Monday): Reshape the IssueBrowser to consume `Finding` (v2 shape: transformId, confidence, remediationMinutes) instead of `CodeIssue` (legacy shape: severity, blastRadius, fixable). Either (a) adapter-map at the boundary or (b) update IssueBrowser's prop types directly. The keys (`a` apply, `A` apply all in filter, `v` verify, `d` diff, `/` filter) keep their UX meaning; the engines underneath change.

Day 30 (Tuesday): Reroute `runner.ts:executeCommand` for `analyze`. Today it calls `Orchestrator.analyze(target)` against the legacy engine; swap to `new RefactronAnalyzer({ confidence }).analyzeExtended(target)`. Map findings into the WorkSession shape persisted at `.refactron/work-sessions/<id>.json`. Open IssueBrowser as before.

Day 31 (Wednesday): Add `run` REPL handler. Calls Week-4's transform engine to build a `RefactorPlan`, hands it to Week-2's `RefactronVerifier`, on success applies via the atomic batch writer. UI: existing `<DiffView>` for the dry-run preview, `<VerificationView>` for the gate progress, `<ProgressBar>` for the test-gate countdown. Flag `--apply` writes; without it, dry-run only.

Day 32 (Thursday): Add `init` (scaffold `.refactronrc.json`) and `document` (Week 6 dependency). `document` is wired to the LLM provider abstraction; on platforms without Ollama, it shows a clear "documentation skipped" panel and exits 0.

Day 33 (Friday): Retire the legacy REPL verbs. Decide per-command: `autofix` aliases to `run --apply`; `verify` aliases to the syntax/imports/tests gate run inline (already wired through `RefactronVerifier`); `status` keeps reading WorkSession; `rollback` stays (uses `BackupManager`); `diff` aliases to `run --dry-run`. Print a deprecation banner for any aliased command pointing to the v2 verb. Unwire the legacy `Orchestrator` calls so the legacy `src/analysis/`, `src/autofix/`, `src/verification/` engines stop being imported by the REPL path. Leave the legacy module trees on disk but unreferenced; deletion is post-launch cleanup.

Day 34 (Saturday): `.refactronrc.json` config schema (JSON Schema 7). Fields: `transforms` (TransformId allowlist), `exclude` (path globs added to discovery's denylist), `testCmd` (overrides runner detection), `confidence` (default `--confidence` for analyze and run), `dryRun` (default behavior for run when --apply not specified). Loaded via cosmiconfig in `src/cli/app.tsx` boot. Surfaces both to the one-shot CLI path and the TUI.

Day 35 (Sunday): Dispatch policy and auth enforcement at every entry point. The fast-path dispatcher in `src/cli/index.ts` keeps an `analyze` intercept for `--json` / non-TTY invocations (one-shot CLI mode for automation), but **the intercept now checks credentials before invoking the engine**: `loadCredentials()` from `~/.refactron/credentials.json` OR `process.env.REFACTRON_TOKEN`; if missing/expired, exit 7 with a clear "run `refactron login` locally and set REFACTRON_TOKEN in your CI" message. When the TTY is interactive AND no `--json` / `--no-tui` flag is set, dispatch falls through to `app.tsx` → TUI → existing LoginFlow → REPL handler. Same auth enforcement for `run` and `document` once Weeks 4/6 ship. Add `REFACTRON_TOKEN` env var support to `loadCredentials()`. Add `--no-tui` global flag for explicit one-shot invocation in interactive shells. Cross-platform sanity pass: macOS (dev machine), Linux (CI), Windows (GH Actions Windows runner). Windows path handling is the only real risk.

**Binary gate:**
1. `refactron` (no args) opens the TUI, prompts login if not authenticated, shows REPL.
2. Inside the REPL: `analyze fixtures/python-legacy-mini` runs the v2 analyzer, opens IssueBrowser with v2 Findings.
3. Inside the REPL: `run --apply --transforms=format_to_fstring fixtures/python-legacy-mini` runs the v2 refactorer + verifier + atomic writer; pytest in the fixture stays green; the file is rewritten.
4. `refactron analyze fixtures/python-legacy-mini --json` (one-shot) bypasses the TUI but **still requires a valid token** (`~/.refactron/credentials.json` or `REFACTRON_TOKEN`). Without one: exit 7, clear error message, no analyzer invocation.
5. With `REFACTRON_TOKEN` set in env: the same one-shot command runs without prompting, prints JSON, exits 0.
6. All three platforms green on CI.

**Risks:**
- IssueBrowser shape mismatch (legacy CodeIssue → v2 Finding). Mitigation: adapter layer at the runner.ts boundary translates v2 Findings into the props the existing browser expects. Lets us defer a deeper refactor of the Ink components.
- CI integration friction (token required for every run). Mitigation: document `REFACTRON_TOKEN` env var loudly in the Week 8 docs site; provide a one-liner `refactron login --print-token` to extract the token for CI secrets without leaking it to stdout history. Add a quickstart "Refactron in CI" page.
- Windows path/line-ending hell. Mitigation: if Windows blocks ship, downgrade to "Tier 2 support" with documented known-issues list. Linux plus macOS are the must-haves.
- Legacy engine code rots silently after Week 5 unwires the REPL imports. Mitigation: add a CI lint that flags net-new imports from `src/analysis/`, `src/autofix/`, `src/verification/`. The trees stay compiled (existing tests still cover them) but get no new callers.

## Week 6 — Documentation Engine (LLM, scoped)

**Goal:** Build Step 4 — the only LLM-touching component. Generates docstrings, inline comments, and CHANGELOG entries for refactors that have already been verified. The LLM never touches code; it only describes verified diffs.

**Why this step is LLM and the others aren't:** Code transformation requires correctness; documentation requires fluency. LLMs are great at the latter, mediocre at the former. This is the only place AI earns its keep in Refactron, and it runs after the diff is on disk — so any hallucinated comment is purely cosmetic, never a code bug.

**Day-by-day:**

Day 36 (Monday): Provider abstraction. LLMProvider interface with OpenAIProvider, AnthropicProvider, and local OllamaProvider for users who refuse to send code to APIs (your trust-conscious audience). Default to local. Opt-in for cloud. Document privacy model loudly in README.

Day 37 (Tuesday): Prompt templates for each doc artifact.
- Docstring template: "Given this function before and after refactoring (diff attached), write a Google-style docstring describing what it does now. Do not describe the refactor itself."
- Inline comment template: for non-obvious lines only.
- CHANGELOG entry: "Summarize this set of transforms in 1-3 bullet points for a user-facing CHANGELOG."

Day 38 (Wednesday): Token-budget control. Chunk diffs at function boundaries. Never send entire files. Redact secrets via --redact-patterns regex list. Defaults: AWS keys, API tokens, .env-like patterns.

Day 39 (Thursday): Idempotency plus caching. Hash (diff + prompt + model) → cache the response. Re-runs are free.

Day 40 (Friday): Failure modes. LLM down. Rate-limited. Returns garbage. All paths fall back to "documentation skipped, code already refactored and verified, run `refactron document` later."

Day 41–42 (Weekend): Integration tests with local Ollama running llama3.1:8b so CI does not depend on paid APIs.

**Binary gate:** Run full pipeline on fixture repos with Ollama running locally. Emit docstrings/comments/CHANGELOG. Verify that without the LLM, the refactor still succeeds. LLM is non-blocking.

**Risks:**
- People assume Refactron is "another AI tool" because of Step 4. Mitigation: messaging discipline. README headline: "Deterministic refactoring. AI never touches your code — only your docs, and only after verification."
- LLM output is bad. Mitigation: it is only docs. Users can edit them. They are never on the critical path.

## Week 7 — CLI plus Real-World Testing

**Goal:** Ship the CLI UX, then drag Refactron through 5 real-world legacy codebases — yours and your beta users' — and fix every bug surfaced.

**Day-by-day:**

Day 43 (Monday): **CLI output redesign — the three flows that matter.**

The CLI subcommand surface (analyze, run, document, init) and global flags (--config, --dry-run, --apply, --json, --verbose, --quiet) already exist from Weeks 3–6. The actual Day 43 work is the **output redesign**: by Week 6 the three core commands (analyze, run --dry-run, run --apply) all show summaries that strip the detail a user needs to act on. Day 43 fixes this with three new formatter modules, wired into both the REPL handler (`src/cli/runner.ts`) and the one-shot CLI handlers (`src/cli/analyze-command.ts`, `src/cli/run-command.ts`). Help text that explains the 3-gate safety model in 3 lines is the easy part; the body of work is the three flows below. Zero changes to the LOCKED contracts in `src/contracts.ts`.

— **`analyze` — per-file detailed findings.** Today's output: severity-grouped flat list with 55-char-truncated messages, no code context, no transform name surfaced to the user. New output: group findings by FILE (not severity); for each finding emit the source line + 1–2 surrounding lines extracted at render time, the transform ID, the human-readable suggestion already in `src/cli/v2-adapters.ts:MESSAGE_BY_TRANSFORM` / `SUGGESTION_BY_TRANSFORM` from Week 5, and the blast level. Summary block expands to break down by file, by transform, by severity, by blast radius. Target file: `src/cli/format-analysis.ts` (~150 LOC), replacing the existing `formatAnalysis()` in `runner.ts`.

— **`run --dry-run` — actual diffs, not file lists.** Today's output: "Dry-run: N file(s) would change" + bullet list of paths, nothing else. New output: per-file unified diff (reuse `src/infrastructure/diff.ts:generateUnifiedDiff` from Week 1), header per file with transforms applied + +/- line counts, truncated to ~30 lines per file with explicit "X more — use --diff-context=N" hint. Summary totals lines / hunks / transforms. Add `--diff-context=N` and `--files=GLOB` flags for scoping. Target file: `src/cli/format-plan.ts` (~200 LOC).

— **`run --apply` — gate-by-gate progress + per-file write results.** Today's output: one-line "✓ N file(s) refactored and verified" on success or one truncated error blob on failure (the `.slice(0, 4000)` front-slice in `src/verify/gates/tests.ts:62` clips off vitest's FAIL section — the most useful info is at the end of the stream). New output: stream per-gate progress as each of the 3 gates completes (✓ syntax, ✓ imports, ✓/✗ tests, each with elapsed time); on success, a per-file atomic-write list tagged with each file's transformId and a pointer to `.refactron/last-apply.json` for the `document` follow-up; on failure, a structured surface — failing test name + first ~20 lines of assertion context (extracted by `summarizeVitestFailures(stdout)` greppping for `FAIL`/`×` lines and parsing forward), the in-flight refactor plan re-printed with explicit "NOT written — your tree is unchanged" caveat (atomic-write semantics), shadow tree path for local reproduction, and a best-effort culprit hint when the failing test path matches a planned file path. Target file: `src/cli/format-verify.ts` (~250 LOC). One engine-side addition: `RefactronVerifier` gains an `onGateComplete?: (gate, result) => void` constructor option so the CLI can stream per-gate UX without changing the LOCKED `Verifier.verify()` signature.

Wire all three formatters into both surfaces (REPL via `runner.ts`, one-shot via `analyze-command.ts` and `run-command.ts`) so the same UX shows in interactive use and in CI's non-JSON path. `--json` output stays machine-readable; the formatters only apply to the human-readable path. Acceptance check before moving to Day 44: re-run the same `analyze` → `run --dry-run` → `run --apply` flow that surfaced the original UX gap on Refactron's own repo, and confirm a user can answer (a) what was found, (b) what would change, and (c) which test broke and what the assertion was — directly from terminal output, without `cat`-ing a log file.

Day 44 (Tuesday): Beta-user repo gauntlet #1 — your own production codebase. Run `refactron analyze`. Triage findings into "would apply," "would not apply," "false positive." Track precision/recall. With Day 43's redesign in place every finding now carries a transform name, source excerpt, and suggestion — making triage actually possible.

Day 45 (Wednesday): Repo gauntlet #2 and #3 — two of your 5–10 industry beta users. Watch them use it (Zoom screen-share if remote). Note every confusion, every error message that did not help. Do not defend the design. Just take notes.

Day 46 (Thursday): Bug-fix day from gauntlets #1–3. Fix the top 5 issues. Cut features ruthlessly if they are causing the bugs.

Day 47 (Friday): Repo gauntlet #4 and #5. Different stacks. Ideally one Django, one Express.

Day 48–49 (Weekend): Performance pass. Benchmark on 10k-LOC, 100k-LOC, 500k-LOC fixtures. Target: under 60s for analyze on 100k LOC. Under 5min for full run including test gate. If slower, profile (clinic.js, 0x) and fix top hot paths.

Reference Ruff's positioning — 10x to 100x faster than Flake8. Performance is part of dev-tool credibility but never trade speed for correctness.

**Binary gate:**
1. The three core commands (analyze, run --dry-run, run --apply) all render the redesigned outputs in both the REPL and one-shot CLI surfaces. `--json` continues to emit machine-readable output unchanged.
2. `run --apply` failure on Refactron's own repo (the self-test paradox where a transform breaks one of Refactron's own meta-tests) now surfaces the failing test name + assertion within ~30 lines of output — not a 4000-char truncated dump that drops the FAIL section.
3. 5 external developers (your beta cohort) have run Refactron end-to-end on their own codebases. Refactron either (a) completed a refactor successfully or (b) failed safely — never wrote broken code.

**Risks:**
- A user's repo breaks Refactron in a way that takes 3 days to fix. Mitigation: time-box debugging. Add failing case to fixtures and ship a known-issue.
- Beta users go silent. Mitigation: you have 5–10. Only need 5 reports. Ask twice, then drop them.
- Output redesign overshoots Day 43. Mitigation: ship `format-verify.ts` first (highest user impact — the failure surface is currently the most unreadable part of the product), then `format-analysis.ts`, then `format-plan.ts`. Each is independent and shippable on its own. If one slips into Day 44, the gauntlets still benefit from the others.
- Diff rendering looks bad in narrow terminals or non-color TTYs. Mitigation: degrade gracefully — `--no-color` strips ANSI; `process.stdout.columns < 80` switches to a compact diff format with file:line headers only.

## Week 8 — External Validation plus Ship

**Goal:** Final hardening. Publish to npm and PyPI. Show HN. Capture metrics.

**Day-by-day:**

Day 50 (Monday): Final security audit. Run npm audit, pip-audit. Verify atomic-write guarantees on Windows. Verify subprocess sandboxing — no shell injection in testCmd paths. Use execa with array args, never string plus shell:true.

Day 51 (Tuesday): Documentation site. Vitepress or Docusaurus. Pages: Quickstart (60-second install plus first refactor), Safety Model (the 3 gates with diagrams), Transforms (one page each with before/after), CLI Reference, Configuration, FAQ, Trust ("Why no LLM for code?"). Cite academic plus industry foundations in the FAQ. Opdyke, jscodeshift, LibCST, ClangMR. Your credibility lives here.

Day 52 (Wednesday): README polish. The repo IS the landing page. README structure:
1. One-line description (no marketing-speak)
2. 30-second demo GIF (use vhs from charm.sh for reproducible terminal recordings)
3. Install plus first refactor in 4 commands
4. The 3-gate safety model in a diagram
5. Transform catalog
6. Honest limitations (no Windows / no Ruby / etc.)
7. Cite academic foundations

Day 53 (Thursday): npm publish dry run (`npm publish --dry-run`). Verify package.json:
- name: refactron
- bin: { refactron: ./dist/cli.js }
- files: [dist, README.md, LICENSE]
- engines: { node: >=18 }

Verify it installs cleanly from a fresh `npm install -g refactron` in a Docker container. Sign with provenance.

Day 54 (Friday): Same for PyPI legacy wrapper. The Python package is a thin shim that detects Node.js, installs the npm package locally if needed, and shells out. Preserves 3,500+ existing PyPI downloads' install path. Verify `pip install refactron` works.

Day 55 (Saturday): Final pre-launch quiet day. Pre-write Show HN comment thread responses. "Why not Cursor?" "Why no Rust?" "Doesn't ESLint do this?" "What about Comby?" "How is this different from jscodeshift?" Honest answers, no marketing.

Day 56 (Sunday/Monday dawn): Ship day. See Part 6 for the detailed launch playbook.

**Binary gate:** `npm install -g refactron && refactron --version` returns 2.0.0 on a fresh machine. Show HN post is live. Founder is in the comments answering every reply within 30 minutes for the first 12 hours.

---

# Part 6 — Shipping Day Execution

## Pre-Ship Checklist (Sunday Day 55 evening)

- npm whoami returns your account. 2FA on.
- `npm publish --dry-run` shows expected file list. No .env, no node_modules, no fixtures/ except docs.
- pip install -e . works for the wrapper.
- README final read-through on mobile (HN traffic skews mobile).
- Demo GIF under 5MB, under 30 seconds, no audio.
- Discord/Slack/Twitter cleared for launch day.
- Phone fully charged. Charger nearby.

## Ship Day — Monday Day 56

**T-2h (07:00 PT / 19:30 IST):** Final smoke test on a clean Docker container.

```bash
docker run -it node:20-alpine sh
npm install -g refactron
refactron --version  # expect 2.0.0
git clone https://github.com/sherikar/refactron-demo-repo
cd refactron-demo-repo
refactron analyze
refactron run --dry-run
refactron run --apply --interactive
```

**T-1h:** Publish.

```bash
cd refactron
npm publish --provenance --access public
# wait 60s, verify on https://npmjs.com/package/refactron
cd ../refactron-py
python -m build && twine upload dist/*
```

**T-0 (09:00 PT / 21:30 IST Monday):** Post Show HN.

Show HN post (frozen text):

> Show HN: Refactron — Deterministic CLI that verifies refactors before writing
>
> Hi HN — I'm Om, 2nd-year B.Tech student building Refactron, an open-source CLI for safety-first refactoring of Python and TypeScript codebases.
>
> The pitch: every existing "AI refactoring" tool (Cursor, Copilot, Continue, Greptile, Patched) generates code and hopes you'll catch the bugs. NYU's study of 1,692 Copilot programs found approximately 40% had exploitable vulnerabilities. An ACM AST 2024 study found 92.45% of Copilot-generated tests fail or are broken when there's no existing suite. That's a non-starter for production codebases I care about.
>
> Refactron does the opposite. The refactoring engine is 100% deterministic AST transforms — no LLM touches your code. Before any file is written, three gates must pass: (1) syntactic validity, (2) import integrity, (3) full test suite on a shadow tree. Atomic write or rollback. The only place AI is used is Step 4: generating docstrings and CHANGELOG entries for already-verified refactors.
>
> 10 transforms at launch — 5 Python (callbacks → async/await, %/.format() → f-strings, runtime checks → type hints, requests → httpx, classes → @dataclass) and 5 TypeScript (var → const/let, promise chains → async/await, implicit any inference, CommonJS → ESM, new Promise → async).
>
> Built on ts-morph and LibCST. Inspired by Opdyke's 1992 refactoring thesis, jscodeshift, Instagram's LibCST work, OpenRewrite's lossless-semantic-tree model, and Google's ClangMR paper.
>
> `npm install -g refactron` or `pip install refactron`. MIT. github.com/sherikar/refactron
>
> Happy to answer questions about the AST work, the verification model, or why I don't think LLMs should be touching production code.

**T+0 to T+12h:** Answer every comment within 30 minutes. Never defend, always engage. When criticized, find the agreeable kernel first.

**Parallel launches at T+0:**
- Tweet thread (8 tweets, leads with demo GIF)
- Post to dev.to (long-form essay, approximately 1500 words on technical design)
- Post to Lobste.rs (programming + practices tags)
- Reddit r/Python, r/typescript (read each sub's rules first)
- Email to 5–10 beta users with "we shipped" note
- Email to F6S plus India Ascends mentors
- LinkedIn post for founder network

## Target Metrics

**Day 1:**
- 500 GitHub stars
- 1,000 npm downloads
- 50 HN comments, top 30 on /show
- 5 high-quality issues opened
- 3 "we'd like to try this internally" emails

**Week 1:**
- 5,000 npm downloads
- 1,500 GitHub stars
- First PR from non-Om contributor merged
- 10 issues triaged plus responded
- One conversation with potential paying customer

**Month 1:**
- 20,000 npm downloads
- 3,000 GitHub stars
- 3 enterprise pilot conversations
- 2 additional transforms shipped (community-requested)
- One conference talk submission (Strange Loop, PyCon, JSConf)
- Decision point: raise seed funding or stay solo and bootstrap

**Failure triggers (when to pivot):**
- Under 1,000 downloads in Month 1 → positioning is wrong, re-test message with beta users
- Under 500 stars → distribution channel is wrong, try YouTube demo plus targeted podcast outreach
- Zero enterprise interest → product is right but go-to-market is consumer, consider Refactron Cloud earlier
- Evōk ships and wins mindshare → double down on transform count and "actually shipping" narrative

---

# Part 7 — Risk Analysis

## Technical Risks

**R1: Deterministic refactoring across 10 transforms is harder than estimated.**

Likelihood: high. Impact: weeks of slip.

Mitigation: Ship fewer transforms. 6 rock-solid > 10 buggy. The roadmap can grow post-launch. Wang et al. ICSE 2018 finding that 38% of test failures involve refactorings means a single buggy transform poisons trust permanently. Cut, don't compromise.

**R2: The test gate is non-deterministic on user codebases (flaky tests).**

Likelihood: very high — most real codebases have flaky tests. Impact: false negatives, user frustration.

Mitigation: Retry baseline up to 3 times. Document explicitly. Offer --skip-test-gate with a giant red warning ("DANGER: bypasses behavior preservation check"). Output coverage stats per Wang et al.

**R3: ts-morph's AST regeneration semantics cause stale-node bugs.**

Likelihood: moderate (docs warn about this explicitly). Impact: silent data corruption.

Mitigation: never hold node references across mutations. Use the project's getSourceFile(path) lookup each time. Add a unit-test asserting this invariant.

**R4: Atomic writes are not actually atomic on Windows (no POSIX rename).**

Likelihood: moderate. Impact: partial writes leave codebase broken.

Mitigation: use write-file-atomic which handles Windows via MoveFileExW with MOVEFILE_REPLACE_EXISTING. Test explicitly on Windows in CI. If unfixable, document Windows as Tier 2.

## Market Risks

**R5: Evōk Labs ships first with similar positioning.**

Likelihood: unknown — they're pre-product. Impact: split mindshare.

Mitigation: speed (8-week MVP). Differentiation: actually ship transforms (not just a "deterministic engine"); ship MIT-licensed; cite the academic foundations. Your moat is being shipped plus maintained, not theoretical.

**R6: AI coding tools (Cursor, Copilot) add "verified refactoring" mode.**

Likelihood: moderate over 12 months. Impact: market squeeze.

Mitigation: Stay deeper than they will. Adding deterministic AST passes is off-mission for AI tools — they're committed to the LLM thesis. By the time they pivot, you're 2 years ahead on the rule library. Cite the NYU 40% vulnerability stat, UTSA 19.7% fabricated packages stat, ACM 92.45% broken-test stat — every README/Show HN comment should remind the market that LLMs cannot do this safely.

**R7: Refactron is mistaken for "yet another linter."**

Likelihood: very high. Impact: low adoption.

Mitigation: lead with the demo. "ESLint tells you. Refactron fixes it — and proves it didn't break anything." Show the 3-gate verification visually. SonarQube, ESLint, Ruff don't transform; they report. Refactron transforms and verifies.

## Execution Risks

**R8: Solo-founder bandwidth.**

Likelihood: certain. Impact: missed weeks.

Mitigation: The plan has Saturday and Sunday as buffer in most weeks. Treat them as buffer, not as more work days. Week 6 (LLM docs) is the easiest cut if needed — ship without it as v1.9 and add it in v2.1. Week 4 is the hardest week. If it slips, slip Week 5 by the same amount and cut polish.

**R9: Beta users go silent during Week 7.**

Likelihood: moderate. Impact: no real-world validation.

Mitigation: Schedule 30-min calls with all 5 in Week 6 for Week 7. Pre-commit them. Offer something in return (early enterprise pricing lock, public attribution).

**R10: Show HN flops.**

Likelihood: moderate. Impact: slow Month-1 growth.

Mitigation: don't ask for upvotes. Engage every comment. If it dies, re-post in 4 weeks with a new angle. Seed via dev.to, Lobste.rs, Reddit r/programming, Python/TS subreddits. The npm package being live is what matters. HN is amplification, not foundation.

---

# Part 8 — The Inviolable Rules

```
1.  models.ts and contracts.ts locked Day 2. Cannot change.

2.  No phase starts until previous gate passes.
    Binary check. No "almost there."

3.  The refactoring engine NEVER uses LLM.
    This is the moat. Cannot be compromised.

4.  Verification runs before every write.
    Atomic write protocol always.

5.  Original file never touched unless safe.
    Not rolled back. Never touched in first place.

6.  Self-analysis must pass before every release.
    Zero CRITICAL issues tolerated.

7.  Test coverage above 80% before ship.

8.  Documentation engine is the only LLM step.
    Everywhere else: deterministic.

9.  3 of 5 external validators must say
    "I would use this" before v2.0.0.

10. No new features added mid-build.
    Backlog everything. Ship the locked plan.
```

---

# Part 9 — GitHub CI/CD

Five workflows. Production grade. Every PR runs through every check.

| Workflow | Trigger | Jobs |
|---|---|---|
| ci.yml | Every PR, push to main | typecheck, lint (Biome), test matrix (Node 18/20/22 × Ubuntu/macOS/Windows), verification gate, build |
| release.yml | v*.*.* tag push | validate tag matches package.json, full test, npm publish --provenance, GitHub release with auto-changelog |
| security.yml | Weekly Monday 9 AM UTC + main push | npm audit (fail on HIGH/CRITICAL), CodeQL, Refactron self-analysis (zero CRITICAL tolerated) |
| nightly.yml | Every night 2 AM UTC | Run analysis on Django, FastAPI, Next.js, Flask, Requests. Any crash auto-creates GitHub Issue. |
| dependabot.yml | Weekly Monday | Dependency PRs. Major versions pinned for ts-morph, LibCST bindings, tree-sitter. |

**The Self-Analysis Gate:**

```bash
node dist/cli/index.js analyze src/ --fail-on high
```

Refactron must pass its own analysis before every PR merges. Zero HIGH or CRITICAL issues tolerated in own source. If Refactron finds a problem in itself, CI fails. No exceptions.

Branch protection on main:
- Require PR before merging (no direct pushes)
- All CI checks must pass
- Require 1 approving review and up-to-date branch
- Block all force pushes (not even repo owner)

---

# Closing — The Product in One Sentence

Every codebase has code nobody wants to touch.

Refactron goes in, modernizes that legacy code, and proves nothing broke before changing a single file.

Build. Verify. Ship.

---

*refactron.dev · npm install -g refactron · pip install refactron*

---

## Citations

**Academic Foundation:**
- Opdyke, W. F. (1992). "Refactoring Object-Oriented Frameworks." PhD thesis, UIUC.
- Roberts, D. (1999). "Practical Analysis for Refactoring." PhD thesis, UIUC.
- Mens, T. & Tourwé, T. (2002). "Formalising Behaviour Preserving Program Transformations." Springer LNCS.
- Fowler, M. (1999, 2018). Refactoring: Improving the Design of Existing Code. Addison-Wesley.
- Letouzey, J.-L. (2012). "The SQALE method for evaluating Technical Debt." ICSE Workshop on Managing Technical Debt.
- AlOmar, E.A. et al. (2021). "On Preserving the Behavior in Software Refactoring: A Systematic Mapping Study." arXiv:2106.13900.
- Wang, K. et al. (2018). "Towards Refactoring-Aware Regression Test Selection." ICSE 2018.
- Mongiovi, M. et al. (2014). "Making Refactoring Safer Through Impact Analysis." Science of Computer Programming 93.
- Brunsfeld, M. (2018). "Tree-sitter: a new parsing system for programming tools." Strange Loop 2018.

**Industry Sources:**
- Facebook/jscodeshift: github.com/facebook/jscodeshift
- Google ClangMR: research.google/pubs/large-scale-automated-refactoring-using-clangmr/
- Instagram LibCST: github.com/Instagram/LibCST
- Instawork engineering: engineering.instawork.com/refactoring-a-python-codebase-with-libcst
- OpenRewrite/Moderne: docs.openrewrite.org
- Comby: comby.dev
- Semgrep autofix: semgrep.dev/blog/2022/autofixing-code-with-semgrep
- ts-morph: ts-morph.com, npmjs.com/package/ts-morph
- write-file-atomic: github.com/npm/write-file-atomic

**Market Validation:**
- Stripe & Harris Poll (2018). "The Developer Coefficient."
- Stack Overflow (2024). Developer Survey 2024.
- Pearce, H. et al. (2022). "Asleep at the Keyboard? Assessing the Security of GitHub Copilot's Code Contributions." IEEE S&P 2022, arXiv:2108.09293.
- Spracklen, J. et al. (2024). "We Have a Package for You! A Comprehensive Analysis of Package Hallucinations by Code Generating LLMs." USENIX Security 2024, arXiv:2406.10279.
- El Haji, K. et al. (2024). "Using GitHub Copilot for Test Generation in Python: An Empirical Study." ACM/IEEE AST 2024, doi:10.1145/3644032.3644443.
- Liu, F. et al. (2024). "Beyond Functional Correctness: Exploring Hallucinations in LLM-Generated Code." arXiv:2404.00971.
