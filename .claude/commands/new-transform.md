---
description: Scaffold a new Refactron transform end-to-end — detector, sidecar (Python) or implementation (TypeScript), v2-adapter entries, tests, and mdx docs — in lockstep so nothing drifts.
---

You're scaffolding a new transform for Refactron. The user will provide:

- Transform id (snake_case, will become a `TransformId` literal)
- Language: `python` or `typescript`
- Tier: `debt` / `modernization` / `style`
- One-sentence purpose

If any of these are missing, ask once via `AskUserQuestion` and proceed once you have them.

## Files to create / modify (Python transform)

1. **Detector**: `src/analyze/detectors/python/<kebab-id>.ts`
   - Implements `detect(ctx)` returning `DetectorFinding[]`.
   - Registers via `register({ transformId: '<id>', lang: 'python', detect })`.
   - Mirror the sidecar's accept predicate exactly — drift causes the #57 class of bug.
2. **Sidecar**: `src/transform/transforms/python/_py/<id>.py`
   - Reads `sys.argv[1]`, calls `_base.read_source` + `_base.emit`.
   - LibCST visitor/transformer with a `preconditions` list.
   - **Every refusal path emits a precondition** with `{id, satisfied: false, reason}`.
3. **TS wrapper**: `src/transform/transforms/python/<kebab-id>.ts`
   - Resolves the sidecar path via `fileURLToPath(import.meta.url)`.
   - Calls `runPythonTransformWithSource(SIDECAR, ctx.source, { relPath })`.
   - Maps `r.newContent === ''` to `null`.
4. **Register**:
   - `src/contracts.ts` — add the literal to the `TransformId` union. (Locked file — note this is an ADDITIVE-ONLY change; if you can't do it additively, stop and escalate.)
   - `src/transform/engine.ts` — add to `TRANSFORM_ORDER` and `REGISTRY`.
   - `src/cli/v2-adapters.ts` — add entries to `MESSAGE_BY_TRANSFORM`, `SUGGESTION_BY_TRANSFORM`, `TIER_BY_TRANSFORM`. (Exhaustive `Record<TransformId, …>` — the compiler will tell you what's missing.)
   - `src/analyze/sqale.ts` — add remediation-minutes estimate.
   - `src/cli/config-loader.ts` — add to the enabled-by-default list if appropriate.
5. **Tests**:
   - `tests/unit/analyze/detectors/python/<kebab>.test.ts` — detector unit tests.
   - `tests/unit/transform/transforms/python/<kebab>.test.ts` — sidecar tests covering: happy path, every refusal id, gate (silence when not a candidate).
   - `tests/integration/analyze-engine.test.ts` — add the transform id to the enabled list.
   - `tests/unit/cli/transform-ids-drift.test.ts` — extend the pinned alphabetized set.
6. **Docs**: `docs/transforms/<kebab-id>.mdx` with frontmatter (`title`, `tier`) + before/after example + refusal reasons listed.
7. **CHANGELOG**: add an `Added` entry under `[Unreleased]`.

## Files to create / modify (TypeScript transform)

Replace steps 2 + 3 with:

2. **Implementation**: `src/transform/transforms/typescript/<kebab-id>.ts`
   - ts-morph-based transformer; takes `ctx.source`, returns `{newContent, preconditions}`.
   - **Every refusal path emits a precondition.**
3. (No sidecar.)

Everything else stays the same.

## Discipline

- **TDD**: write the failing detector test first; then the sidecar test; then implement. Each test must fail for the right reason before you implement.
- **Atomic writes**: not your concern — the engine handles writes. Just return `newContent`.
- **Tier**: think about it. If you can't justify the tier in one sentence, the tier is wrong.
- **No `--no-verify`** at commit time. Hook fails → fix the underlying issue.

After scaffolding, run the full pre-publish chain and dispatch `/review` before opening a PR.
