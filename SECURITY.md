# Security Policy

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report privately via either:

- Email: `omsherikar0229@gmail.com`
- GitHub Security Advisory: https://github.com/Refactron-ai/refactron/security/advisories/new

You will receive an acknowledgement within **72 hours**. For high or critical issues we will coordinate disclosure with you and aim to ship a patched release before any public details are published. Please give us a reasonable embargo window before disclosing publicly.

When reporting, include: a description, reproduction steps, the affected version, and the potential impact.

## Supported versions

| Version      | Status                                         |
| ------------ | ---------------------------------------------- |
| `0.2.x`      | Supported — security fixes will be backported. |
| `0.1.x-beta` | **Not supported.** Please upgrade to `0.2.x`.  |

## Threat model

Refactron is a deterministic verification layer. The core pipeline (shadow tree → syntax → imports → tests → coverage) contains **no LLM in the critical path**. Every change committed to disk originates from a registered transform with documented preconditions and is gated by three deterministic verifiers (syntax, imports, tests). The published surface cannot generate code that wasn't produced by a reviewed transform — there is no path by which a hallucinated or hostile model response can rewrite a user file.

The `document` step (Step 4 of the pipeline, in `src/document/`) is the only LLM-touching component. It runs **only on already-verified diffs** and produces docstrings, commit messages, and CHANGELOG entries — never executable code that participates in verification. The worst-case outcome of a malicious or hallucinated LLM response is an incorrect docstring or a misleading changelog line; the underlying refactor remains correct because it was verified before the LLM was ever consulted.

Document-side mitigations:

- **Secret redaction** — `src/document/redact.ts` strips API keys, bearer tokens, and `.env`-style assignments from prompts before they leave the process.
- **Provider-error fallback** — if the LLM call fails or returns garbage, the refactor stays applied; only the documentation step is skipped or marked degraded.

Atomic write guarantees: Refactron never writes to your working tree; verification runs entirely against an isolated shadow copy. On any rename failure, the remaining temps are unlinked. There is no partial-write state — a refactor plan either commits in full or leaves the working tree untouched.

## Subprocess safety

All subprocess invocations use `execa(cmd, [args], opts)` array-form. There is no `child_process.exec` and no string interpolation into command strings; `shell: true` is **not** used for any tool-invoked command. The `execa` call sites in `src/` (the Python sidecars, the test runner, and the Python interpreter probes) all pass arguments as arrays.

**One intentional exception**: when the user supplies a `testCmd` in `.refactronrc.json` (or via `--test-cmd`), Refactron runs it through `sh -c` (`src/verify/runners/detect.ts:27`). This is the entire purpose of the field — users need to express things like `vitest run --testNamePattern foo` or chained pipelines. The trust boundary is the `.refactronrc.json` file: **a hostile `.refactronrc.json` in a repository can run arbitrary shell commands inside the verifier's shadow tree**, equivalent to running that repository's own test suite. Refactron is therefore no more or less safe than running `npm test` (or `pytest`) on an untrusted repository. Treat unfamiliar `.refactronrc.json` files with the same caution you would treat unfamiliar `package.json` `scripts` blocks.

## Atomic-write guarantees

Refactron never writes to your working tree. Verification applies the diff to an isolated shadow copy under the system temp directory, runs the gates there, and removes it. There is no write path to your files in any command, for any verdict. The atomic batch writer that used to land migration-mode changes was removed in 0.4.0 along with the transforms.

## Known dependency advisories

As of the `0.2.x` release, `npm audit` reports **0 vulnerabilities** of any severity in the production or development dependency graph.
