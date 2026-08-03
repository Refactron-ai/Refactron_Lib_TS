# Runbook

Operational playbooks. Pair with `release-manager` and `security-engineer` subagents for the judgment calls.

---

## Release process (patch / minor)

For breaking (major) releases, see "Major release" below.

**Refactron ships two artifacts per release: the npm package and the PyPI
wrapper (`refactron-py/`).** They are versioned in lockstep. **npm must be
published first**, because the PyPI package is a thin shim that shells out to
the npm CLI: a pip user who installs before npm is live gets a wrapper that
correctly refuses to run. Publishing pip first is a broken window, not a
disaster, but the ordering is not optional.

### Prepare

1. **Confirm clean working tree.** `git status` shows nothing uncommitted on `main`.
2. **Pull latest.** `git checkout main && git pull origin main`.
3. **Run the full pre-publish chain.**
   ```bash
   npm run prepublishOnly
   ```
   Must be green. If anything fails, fix it on a branch and merge first.
4. **Check dependency advisories.**
   ```bash
   npm audit
   ```
   Resolve anything high or critical before publishing. `npm audit fix --package-lock-only` handles the transitive cases without touching declared ranges; anything needing a range change is a separate PR, not a release-day edit.
5. **Update CHANGELOG.md.** Move items from `[Unreleased]` to a new `[X.Y.Z] — YYYY-MM-DD` section. Group: Added / Changed / Fixed / Deprecated / Removed / Security. Entries must be user-facing.
6. **Mirror the entry into `docs/changelog.mdx`.** Convert the `<Update label="Unreleased">` block into a released block: `<Update label="X.Y.Z" description="Month D, YYYY">`. The closing `</Update>` must sit at column 0 with a blank line before it, or Mintlify fails to parse the page (see PR #76).
7. **Bump both versions.**
   - `package.json#version`
   - `refactron-py/refactron/__init__.py` `__version__`

   That Python literal is the **single source of truth** for the wrapper: `refactron-py/pyproject.toml` reads it statically via `[tool.setuptools.dynamic]`, so there is nothing else to edit and the two cannot drift. Sync the lockfile's copy of the version with `npm install --package-lock-only`.

8. **Sweep the docs for the old version.** Install commands are pinned in prose.
   ```bash
   grep -rn "refactron@0\.\|refactron==0\." README.md docs/ | grep -v changelog
   ```
   Every hit must name the version you are about to publish.
9. **Commit.**
   ```bash
   git commit -am "chore(release): vX.Y.Z"
   ```
10. **Tag.**
    ```bash
    git tag -a vX.Y.Z -m "vX.Y.Z"
    ```

### Dry-run both artifacts

11. **npm.**
    ```bash
    npm publish --dry-run
    ```
    Verify the file list against `package.json#files`: no `dev-docs/`, no `playground/`, no `.refactron/`, no `tests/`, no `bench/`, no `docs/`. Source maps **are** shipped on purpose, so a user reading a CLI stack trace gets real line numbers; do not "fix" that. **Confirm the Python sidecars are present**: `dist/verify/checks/_py/*.py` and `dist/transform/transforms/python/_py/*.py`. They are copied by `build:copy-py`, not emitted by `tsc`, so a build-script regression drops them silently and the verification engine ships broken.
12. **PyPI.**
    ```bash
    cd refactron-py
    rm -rf dist build refactron.egg-info
    python3 -m build                 # needs `pip install build`
    python3 -m twine check dist/*    # needs `pip install twine`
    ```
    Both artifacts must report `PASSED`. Confirm the version in the filenames is the one you bumped, and that `LICENSE` and `NOTICE` are in the sdist (`tar tzf dist/refactron-X.Y.Z.tar.gz`).
13. **Push.**
    ```bash
    git push origin main --tags
    ```

### Publish: pushing the tag IS the release

14. **Push the tag and let CI publish.**
    ```bash
    git push origin main --tags
    ```
    `.github/workflows/release.yml` fires on `v*.*.*` and runs the whole release: it validates the tag against both versions, runs the full suite, publishes to npm and PyPI over OIDC trusted publishing, then drafts the GitHub Release. There are no tokens to paste and nothing to run by hand.

    Watch it:

    ```bash
    gh run watch $(gh run list --workflow Release --limit 1 --json databaseId --jq '.[0].databaseId')
    ```

    If `Validate Tag` fails, nothing publishes: every later job is skipped. Fix the mismatch on `main`, delete the tag locally and on the remote, then re-tag the new commit.

15. **Manual publishing is a fallback, not the path.** Use it only when the pipeline itself is broken, and never after a tag has already published, because a second attempt at the same version errors on npm and is silently skipped on PyPI.

    ```bash
    npm publish                                              # npm first: the pip wrapper shells out to this CLI
    cd refactron-py && python3 -m twine upload dist/*
    ```

    PyPI credentials come from an API token in `~/.pypirc` or `TWINE_USERNAME=__token__` / `TWINE_PASSWORD=pypi-...`. PyPI does not allow re-uploading a filename, so a bad upload means burning the version number and shipping X.Y.Z+1.

16. **GitHub Release.** CI drafts it from the tag. Review the body, replace the generated commit list with the CHANGELOG section, and publish it.

### Verify what you published

17. **npm install.**
    ```bash
    cd /tmp && rm -rf verify-release && mkdir verify-release && cd verify-release
    npm init -y
    npm install refactron@X.Y.Z
    npx refactron --version            # should print X.Y.Z
    ```
18. **The sidecars survived the tarball.**
    ```bash
    ls node_modules/refactron/dist/verify/checks/_py/
    ls node_modules/refactron/dist/transform/transforms/python/_py/
    ```
    Both must be non-empty.
19. **The MCP bin exists.**
    ```bash
    ls node_modules/.bin/refactron-mcp
    ```
20. **The pip wrapper works.**
    ```bash
    cd /tmp && rm -rf verify-pip && python3 -m venv verify-pip
    ./verify-pip/bin/pip install refactron==X.Y.Z
    ./verify-pip/bin/refactron --version   # should print X.Y.Z via the npm CLI
    ```
    Then check the failure path, which is the one users actually hit. With the npm CLI off `PATH`, the wrapper must print `npm install -g refactron@X.Y.Z` and exit non-zero. It must **never** install anything and must **never** loop: inside a venv the name `refactron` resolves to the wrapper's own console script, and re-executing it is an infinite loop (fixed in 0.3.0, worth re-checking whenever `cli.py` changes).

If any step fails after `npm publish` or `twine upload`, see "Rolling back a bad publish" below.

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

**PyPI differs from npm here.** You cannot re-upload a filename, ever, so the fix is always a new version, never a replacement. `twine` has no unpublish. You can **yank** a release from the PyPI web UI (Manage, then the release, then Options, then Yank), which hides it from new resolutions while leaving it installable for anyone who pinned it exactly. Yank a broken wrapper as soon as the replacement is up; a yanked release still satisfies `refactron==X.Y.Z`, which is what keeps existing lockfiles working.

Because the wrapper is version-locked to npm, a bad npm publish also makes the matching pip release wrong. Ship the patch to both, in the same npm-then-pip order.

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
