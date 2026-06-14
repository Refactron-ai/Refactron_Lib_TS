# Runbook

Operational playbooks. Pair with `release-manager` and `security-engineer` subagents for the judgment calls.

---

## Release process (patch / minor)

For breaking (major) releases, see "Major release" below.

1. **Confirm clean working tree.** `git status` shows nothing uncommitted on `main`.
2. **Pull latest.** `git checkout main && git pull origin main`.
3. **Run the full pre-publish chain.**
   ```bash
   npm run prepublishOnly
   ```
   Must be green. If anything fails, fix it on a branch and merge first.
4. **Update CHANGELOG.md.** Move items from `[Unreleased]` to a new `[X.Y.Z] — YYYY-MM-DD` section. Group: Added / Changed / Fixed / Deprecated / Removed / Security. Entries must be user-facing.
5. **Bump version.** Edit `package.json#version`. Commit:
   ```bash
   git commit -am "chore(release): vX.Y.Z"
   ```
6. **Tag.**
   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z"
   ```
7. **Dry-run publish.**
   ```bash
   npm publish --dry-run
   ```
   Verify the file list: no `dev-docs/`, no `playground/`, no `.refactron/`, no `tests/`, no source maps.
8. **Push.**
   ```bash
   git push origin main --tags
   ```
9. **Publish.**
   ```bash
   npm publish
   ```
10. **GitHub Release.** Draft a release on GitHub using the new tag; copy the CHANGELOG section into the body.
11. **Verify the install works.**
    ```bash
    cd /tmp && mkdir verify-release && cd verify-release
    npm init -y
    npm install refactron@X.Y.Z
    npx refactron --version    # should print X.Y.Z
    ```

If any step fails after the `npm publish`, see "Rolling back a bad publish" below.

---

## Major release (breaking)

Same as the patch/minor process, plus:

- **ADR exists** for every breaking change, accepted before tagging.
- **Migration guide** at `docs/migrations/vX-to-vY.mdx`. Pinned in the GitHub Release body.
- **Deprecation cycle complete.** Anything being removed was deprecated in the prior minor with a warning pointing at the replacement.
- **Codemod (where feasible).** Eat our own dogfood — `npm install refactron-codemod-vX-to-vY` should automate the migration.

Do not ship a major on a Friday.

---

## Rolling back a bad publish

**You cannot un-publish from npm.** A `npm unpublish` is restricted to ≤ 72h after publish and is discouraged; even then it leaves a tombstone.

Instead:

1. **Immediately publish a patch reverting the change.**
   ```bash
   git revert <commit>
   # fix CHANGELOG to reflect the revert
   npm version patch -m "chore(release): vX.Y.Z+1 — revert <thing>"
   npm publish
   ```
2. **`npm dist-tag` shenanigans** are tempting but break consumers who pinned to `latest`. Don't.
3. **Issue a security advisory** via `gh api repos/Refactron-ai/Refactron_Lib_TS/security-advisories` if the bad publish has a security impact.
4. **Communicate.** Pin a notice in the GitHub Discussions; mention in the next CHANGELOG entry under `Security` or `Fixed`.

---

## Responding to a CVE in a dependency

Triage in order:

1. **Severity?** Look at the CVSS score and the actual call paths. A 9.8 in a dep we never invoke at runtime is lower-priority than a 7.5 in a hot path.
2. **Patched version available?**
   - Yes, semver-compatible → bump the lockfile, run the suite, publish a patch.
   - Yes, but requires a major bump → assess: file an ADR for the upgrade if it's a transitive dep that forces our majors; pin the safe version meanwhile.
   - No → check if the vuln is exploitable in our usage; if not, add an exception with a documented expiry date.
3. **Disclose if needed.** If our usage was exploitable, draft a GHSA via GitHub's Security Advisories. Coordinate disclosure timing.

---

## Regenerating golden snapshots

The e2e suite uses Vitest snapshots in `tests/e2e/__snapshots__/`. Regenerate ONLY when a snapshot diff is intentional.

```bash
npm run test:e2e -- -u
```

Then **diff the snapshot file manually** before committing. Every changed line should be explainable. If you can't explain it, you have a real regression hiding in the regen.

Commit message: `test(e2e): regenerate snapshot for <change>`. Reference the PR that motivated the regen.

---

## Updating LibCST (Python sidecar dep)

LibCST is vendored via the runtime's Python install (`pip install libcst` in CI). We don't pin it in our package but the floor matters.

1. Bump the CI workflow's `pip install libcst==X.Y.Z`.
2. Run `npm test` locally with the new version.
3. Test on `playground/ansible` end-to-end (`analyze` → `run --dry-run` → spot-check).
4. If anything broke, the breakage is one of:
   - LibCST API change (very rare for patch; check the changelog).
   - LibCST behavior change in parsing edge cases.
   - Our code relying on undocumented LibCST internals.
   Fix in our code, not by pinning to the old LibCST.

---

## Updating Vitest (or another major test framework dep)

1. Read the migration guide for the version.
2. Bump in `package.json`.
3. `npm run test`. Most failures will be config-shape changes (`vitest.config.ts`).
4. Pay attention to: snapshot serializer differences, timing semantics in `vi.useFakeTimers`, mock isolation defaults.
5. If snapshots changed across versions for unrelated reasons, regen + diff manually (see above).

---

## Setting up a new dev environment

Mac / Linux:

```bash
brew install node python3        # or your distro's package manager
git clone https://github.com/Refactron-ai/Refactron_Lib_TS.git
cd Refactron_Lib_TS
git config core.hooksPath .githooks    # enable commit-msg + pre-commit hooks
npm install
npm run build
npm test
```

Windows: WSL2 is the supported path. Native Windows works for most tests but the POSIX-mode tests skip themselves (see `tests/unit/atomic-writer.test.ts`).

---

## Investigating a transform that produces no changes despite findings

Common pattern (the #57 class of bug):

1. Run `analyze` — confirm findings exist.
2. Run `run --dry-run --transforms=<id> --json` — confirm `plan.changes.length === 0`.
3. Probe `plan.preconditions`:
   ```bash
   # Use a probe script like /tmp/probe-mt.mjs that drives the engine
   # programmatically and prints preconditions by stem.
   ```
4. If `preconditions` is empty or covers fewer files than `findings`:
   - The sidecar is silently refusing without emitting a record. Fix per the precondition discipline (`.claude/agents/python-sidecar-specialist.md`).
5. If preconditions cover all files with reasons:
   - The refusals are real. The fix is either to tighten the detector (so it doesn't flag uncatchable cases) or to expand the rewriter (so it handles the patterns it's currently refusing).

---

## Triaging an incoming issue

1. **Reproducer?** If not, ask for one. Most "bug reports" become non-bugs once a repro is attempted.
2. **Label** — `bug` / `feature` / `docs` / `question` / `good-first-issue` (only for tightly-scoped, low-context tasks).
3. **Severity** — `critical` (data loss, security, prod down) / `high` (broken core feature) / `medium` (broken edge feature) / `low` (cosmetic, nit).
4. **Assign** if obvious; otherwise leave unassigned and let someone claim.
5. **Link** any related issue/PR with `Related to #N`.

---

## When the runbook doesn't cover your situation

- Write it down as you figure it out. Append a new section here.
- Open an ADR if the situation involves an architectural call you'd want a future person to find.
- A runbook entry that doesn't exist costs the next engineer an hour. Cheap to write, expensive to skip.
