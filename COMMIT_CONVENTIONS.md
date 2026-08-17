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

## Version policy: the minor is earned, not derived

**Stay in the current minor. Ship patch releases (`0.4.1`, `0.4.2`, ...) until
the milestone that the next minor stands for is actually delivered.**

Conventional Commits will suggest a bump, and semver's 0.x rule says a behaviour
change belongs in the minor. Neither decides it here. In this repository the
minor marks the product reaching a goal, so `feat:` commits and behaviour changes
alike land in a patch until that goal is met. Do not propose a minor bump on a
semver mechanic alone, and do not re-raise it once the call is made.

Two consequences to work with rather than argue about:

- `^0.4.0` resolves to `>=0.4.0 <0.5.0`, so a patch **does** reach existing users
  automatically where a minor would not. A behaviour change shipped as a patch is
  therefore louder, not quieter, in practice.
- Because the version number is not carrying the signal, **the changelog has to.**
  Any release that changes what a verdict means leads with that, in plain words,
  above the fix list.

---

## Why these rules exist

- **Conventional Commits** lets `release-manager` agents and `release-please` tooling derive semver bumps + changelog sections automatically. Inconsistent commits mean manual triage at release time — but the bump they _suggest_ is a suggestion; see the version policy above.
- **No `--no-verify`** is the difference between "we have a working hook" and "we have a hook we work around." Once you bypass once, everyone else does too.
- **No co-author trailers** keeps `git blame` and contributor stats accurate. The reviewer who shipped it owns it.
- **Scope vocabulary** makes `git log --grep="(transform-sidecar)"` useful. Without it, the log is grep-hostile.

---

## When in doubt

Read recent commits: `git log --oneline -20`. The patterns are visible. If your message doesn't fit those patterns, ask before committing — don't invent a new convention in a one-off PR.
