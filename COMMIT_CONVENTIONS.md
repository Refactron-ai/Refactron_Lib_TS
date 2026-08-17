# Commit Conventions

Conventional Commits, with this repository's specific scope vocabulary and authorship rules.

---

## Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

- **Subject**: imperative, present tense, no trailing period, ≤ 72 chars.
- **Body**: optional. Wrap at 80. Explains _why_, not _what_ the diff shows.
- **Footer**: optional. `Closes #N` / `Refs #N` / `BREAKING CHANGE: …`.

---

## Allowed types

| Type       | When to use                                                                                |
| ---------- | ------------------------------------------------------------------------------------------ |
| `feat`     | A new user-visible feature. Triggers a minor bump.                                         |
| `fix`      | A bug fix. Triggers a patch bump.                                                          |
| `perf`     | A change that improves performance without changing behavior. Patch.                       |
| `refactor` | Code change that neither fixes a bug nor adds a feature. Patch (no public surface change). |
| `test`     | Adding or correcting tests only. Patch.                                                    |
| `docs`     | Documentation only. Patch.                                                                 |
| `chore`    | Tooling, CI, build infrastructure, dep bumps. Patch.                                       |
| `ci`       | CI workflow changes specifically. Patch.                                                   |
| `style`    | Formatting, whitespace. Patch. (Rare — should be auto-applied by prettier.)                |
| `revert`   | Reverts a previous commit. Patch or minor depending on what was reverted.                  |

If the type field becomes a guess, your commit is doing two things. Split it.

---

## Repository-specific scopes

Use these scopes; don't invent new ones without adding them here first.

| Scope               | Covers                                                                  |
| ------------------- | ----------------------------------------------------------------------- |
| `analyze`           | `src/analyze/`, detectors, blast-radius                                 |
| `transform`         | `src/transform/`, engine, TRANSFORM_ORDER                               |
| `transform-sidecar` | The Python sidecars under `src/transform/transforms/python/_py/`        |
| `verify`            | `src/verify/`, 3-gate verification engine                               |
| `cli`               | `src/cli/`, command parsing, format-plan                                |
| `document`          | `src/document/`, docstring + changelog generation                       |
| `python-adapter`    | `src/adapters/python/`, the Python subprocess boundary                  |
| `ts-adapter`        | `src/adapters/typescript/`, ts-morph wrapper                            |
| `infra`             | `src/infrastructure/` — atomic-writer, diff, git                        |
| `pipeline`          | `src/pipeline/` — session, store, queue                                 |
| `contracts`         | `src/contracts.ts` (locked — should be rare and always paired with ADR) |
| `core`              | `src/core/` (locked — rare)                                             |
| `docs`              | `docs/` mdx files                                                       |
| `dev-docs`          | `dev-docs/` internal docs                                               |
| `ci`                | `.github/workflows/`                                                    |
| `deps`              | `package.json` dep changes                                              |
| `release`           | `CHANGELOG.md`, version bumps                                           |

Multiple scopes: comma-separated, no spaces: `fix(cli,document): …`.

---

## Rules (enforced at review)

1. **No `claude` anywhere in the commit message.** Not in subject, body, or trailers. (Same rule applies to `gemini`, `gpt-4`, etc.)
2. **No co-author trailers.** Authorship belongs to the human who reviewed and committed the change.
3. **No `--no-verify`.** If a hook fails, fix the underlying issue. The hook exists to catch a class of bug; bypassing it means shipping that bug.
4. **No `--amend` on a commit that's already been pushed.** Force-push history rewrites are a CR-block.
5. **`BREAKING CHANGE:` footer is mandatory** for any commit that introduces an API/CLI/file-format break. The footer is what tooling reads to bump major.
6. **One logical change per commit.** A small fix gets its own commit. Do not bundle several fixes into one large commit because they were found in the same sitting.

---

## One logical change per commit

**The unit is the change, not the work session.** If you fixed five things, that is five commits, even when they are one-line each and even when they all came out of the same review.

The test: _can this commit be reverted on its own without taking anything unrelated with it?_ If reverting to undo one fix would also undo four others, the commit was too big.

Why this is enforced rather than encouraged:

- **Revert granularity is the whole point.** A false verdict traced to one of five bundled fixes cannot be backed out without losing the other four, so the fix becomes a new forward patch under time pressure — the worst moment to be writing code.
- **`git bisect` resolves to a commit.** A commit containing ten fixes tells you the bug is in one of ten places, which is barely better than not bisecting.
- **Review attention is per-diff, not per-line.** Ten fixes in one diff get one pass of attention spread thin. The reviewer's third question is sharpest on the third commit and absent on the third hunk of a large one.
- **`git log --oneline` is the changelog draft.** One subject covering ten fixes means writing the release notes twice.

Practical shape, for a review that returns several findings: one commit per finding, each with its own test, in an order where every commit leaves the suite green. Related but separable work — the code fix, the doc correction it implies, the ADR amendment — are separate commits in the same PR, not one commit.

The exception is a change that is genuinely atomic: a rename that must move a symbol and every call site together, or a fix whose test cannot pass without it. Those are one commit because splitting them ships a red tree, not because they are convenient together.

---

## Examples

### Good

```
fix(transform-sidecar): emit preconditions on every manual_typecheck refusal

Closes #57.

Four return paths in leave_FunctionDef previously bailed silently;
post-PR they each emit a descriptive precondition. Gate emission on
_function_has_isinstance_signal so unrelated siblings stay silent.

Re-running on Ansible: 16 silent files → 0.
```

```
feat(analyze): tier transforms as debt / modernization / style
```

```
chore(deps): bump vitest to 3.2.4
```

### Bad

```
update stuff                                # no type, no scope, no info
```

```
fix: bug                                    # subject is meaningless
```

```
feat(transforms): add new transform + fix bug + update docs   # three things
```

```
fix(cli): the issue from yesterday          # un-greppable
```

```
feat: massive refactor of the verification engine

Co-Authored-By: Claude <noreply@anthropic.com>  # forbidden trailer
```

---

## Why these rules exist

- **Conventional Commits** lets `release-manager` agents and `release-please` tooling derive semver bumps + changelog sections automatically. Inconsistent commits mean manual triage at release time.
- **No `--no-verify`** is the difference between "we have a working hook" and "we have a hook we work around." Once you bypass once, everyone else does too.
- **No co-author trailers** keeps `git blame` and contributor stats accurate. The reviewer who shipped it owns it.
- **Scope vocabulary** makes `git log --grep="(transform-sidecar)"` useful. Without it, the log is grep-hostile.

---

## When in doubt

Read recent commits: `git log --oneline -20`. The patterns are visible. If your message doesn't fit those patterns, ask before committing — don't invent a new convention in a one-off PR.
