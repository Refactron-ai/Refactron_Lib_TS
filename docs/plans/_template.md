# Plan: <Feature name>

> Owner: <github-handle>
> PRD: `docs/prd/<name>.md`
> Started: YYYY-MM-DD
> Target merge: YYYY-MM-DD

## Goal

One sentence. What this plan delivers.

## Architecture

Two to three sentences. The approach — names of the files/modules involved, the data flow, the boundaries.

## Tech / dependencies

- Languages: TypeScript / Python (LibCST / ts-morph)
- New deps (if any): name + why
- Files locked: `src/contracts.ts`, `src/core/models.ts`, `src/adapters/interface.ts` — **list any locked file this plan touches.** If listed, the plan REQUIRES principal-engineer review + ADR.

---

## Task breakdown

Each task is a self-contained PR-sized unit. Aim for ≤ 6 hours of focused work. If a task is bigger, split.

### Task 1: <name>

**Files:**
- Create: `path/to/new.ts`
- Modify: `path/to/existing.ts:42-58`
- Test: `tests/unit/path/to/new.test.ts`

**Steps (TDD):**

- [ ] **Write failing test.** Inline the test code. Confirm it fails for the right reason (not "module not found").
- [ ] **Implement minimum** to pass. Inline the implementation sketch.
- [ ] **Verify:** `npx vitest run tests/unit/path/to/new.test.ts -t "<case>"` — passes.
- [ ] **Commit:** `feat(<scope>): <subject>` — no `claude` in message.

### Task 2: …

(Repeat the structure. Tasks should compose: Task 2 can start once Task 1's commit is merged.)

---

## Pre-merge gates

Every task's PR must pass:

- [ ] `npm run typecheck`
- [ ] `npm run lint` (no warnings)
- [ ] `npm run format:check`
- [ ] `npm test` (full suite)
- [ ] `npm run build`
- [ ] Locked-file invariant (`/check-locked` clean unless plan explicitly waives it)
- [ ] Empirical verification on `playground/ansible` if the change is user-visible

## Post-merge verification

How you'll confirm in production / the next nightly that this actually shipped what the PRD asked for. Cite the success metric from the PRD and the command/check that measures it.

## Out of scope (deferred)

- [ ] Issue #___ — <follow-up>
