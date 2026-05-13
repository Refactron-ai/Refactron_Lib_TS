# ADR 008 — Week 6 Architecture (Documentation Engine)

## Status
Accepted, 2026-05 (Week 6).

## Context
The deterministic refactor pipeline (analyze → run → verify → write) is shipped.
Refactron's Inviolable Rule #1 — "LLMs never write code" — remains intact. This
week adds Step 4: docstring and CHANGELOG generation for verified refactors. The
LLM never touches code; it only describes verified diffs.

## Decision
- **New engine package** `src/document/` implementing the LOCKED
  `Documenter.document(verified): Promise<DocPatch>` contract from
  `src/contracts.ts`.
- **Pluggable LLM providers** via a narrow `LLMProvider` interface:
  - `OllamaProvider` (default, local, no auth)
  - `OpenAIProvider` (cloud, `OPENAI_API_KEY` env-only)
  - `AnthropicProvider` (cloud, `ANTHROPIC_API_KEY` env-only)
  - `MockLLMProvider` (deterministic, used in unit/integration/e2e tests)
- **All HTTP via native fetch**. Zero new runtime deps.
- **Token budget + secret redaction** applied to every prompt before transmission.
  Built-in redaction covers AWS, OpenAI, Anthropic, GitHub, JWT, and `.env`-style
  patterns. Custom regexes via `documentation.redactPatterns`.
- **File-based response cache** at `.refactron/cache/llm/` keyed by
  `sha256(provider+model+templateVersion+prompt)`. Template-version bumps
  auto-invalidate without user intervention.
- **Last-apply snapshot** at `.refactron/last-apply.json` is the bridge between
  `run --apply` and `document`. `WorkSession` shape is NOT extended — keeping
  it clean for the legacy boot path that still depends on it.
- **Scope cut to two artifact types** for v2.0: docstrings + CHANGELOG. Inline
  comments are deferred to v2.1 because they lack a canonical AST insertion
  position and risk feeling cluttery without further heuristic work.
- **Default behavior is dry-run** (`document` prints the proposed DocPatch);
  `document --apply` performs the writes. Mirrors `run`.
- **Failure modes are non-fatal**: provider unreachable, rate-limited, garbage
  output, or per-symbol error all degrade to "documentation skipped" rather than
  failing the command. The refactor is already on disk and verified; the docs
  are non-critical.

## Consequences
- Refactron ships with a fully local default — no API keys needed for the
  trust-conscious audience.
- The CI path uses `MockLLMProvider` via `REFACTRON_DOCUMENT_MOCK=1`; real LLMs
  are never required for CI to pass.
- The docstring insertion is regex-based (no AST round-trip). It works
  reliably for top-level Python `def`/`class` and TS `function`/`class`/arrow
  patterns. Nested functions, decorated functions with multi-line decorators,
  and complex JSX patterns may be skipped. v2.1 polish: swap in tree-sitter or
  LibCST for AST-aware insertion.
- `WorkSession` stays clean; the document command depends on a separate file
  (`.refactron/last-apply.json`) so future engine work can persist whatever it
  needs without touching the session schema.

## References
- Source-of-truth: `dev-docs/Refactron_Detailed_Execution_Plan.md` §Week 6.
- Locked contract: `src/contracts.ts:63-66` (`DocPatch`) and `:80-82` (`Documenter`).
- Research: NYU Copilot vulnerability study (~40% exploitable),
  ACM AST 2024 Copilot test-suite study (~92% broken without prior tests).
  Both motivate keeping the LLM far from the critical path.
