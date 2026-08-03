# Release checklist: v0.3.0

**Semver call: MINOR.** Purely additive. New commands (`verify-diff`, `preflight`), a new bin (`refactron-mcp`), new report fields. No `TransformId` renamed or removed, no CLI flag removed, no `.refactron/` field dropped, no locked contract shape changed (`src/contracts.ts`, `src/core/models.ts`, `src/adapters/interface.ts` are untouched on this branch). A 0.2.4 consumer upgrading sees identical behavior from `analyze`, `run`, and `document`.

**Two artifacts ship, in this order: npm, then PyPI.** The PyPI package is a thin shim that shells out to the npm CLI. If pip goes first, a `pip install refactron==0.3.0` lands a wrapper whose only correct behavior is to refuse to run.

---

## Verified on this branch

| Check | Result |
| --- | --- |
| `npm run prepublishOnly` (clean, build, typecheck, lint, test) | exit 0; 137 files, 968 tests, 0 failures |
| `npm run format:check` | clean |
| `npm audit` | 0 vulnerabilities, down from 6 (4 high) |
| Locked contracts untouched | `src/` and `tests/` have no changes on this branch at all |
| `npm pack --dry-run` file list | 852 entries, 1.70 MB unpacked, 0.42 MB tarball |
| Non-`dist/` payload | exactly `CHANGELOG.md`, `LICENSE`, `NOTICE`, `README.md`, `SECURITY.md`, `package.json` |
| Forbidden paths in the tarball | none: no `tests/`, `dev-docs/`, `playground/`, `.refactron/`, `bench/`, `docs/`, `video/` |
| Python sidecars in the tarball | **all 19 present**, including `dist/verify/checks/_py/{syntax_check,imports_check,statement_map}.py`. 0.2.4 shipped 18; `statement_map.py` is the new AST-containment sidecar |
| Both bins in the tarball | `dist/cli/index.js`, `dist/mcp/server.js` |
| Source maps | 414 present, deliberately. 0.2.4 shipped 390, so this is the existing convention, not a regression |
| `python3 -m build` (wrapper) | sdist + wheel built, version resolves to 0.3.0 |
| `python3 -m twine check dist/*` | PASSED on both artifacts |
| Wrapper `LICENSE` + `NOTICE` in sdist and wheel | present, Apache-2.0 |
| Wrapper installed into a clean venv | `pip install` succeeded |
| Wrapper missing-CLI path | prints `npm install -g refactron@0.3.0`, exits 1, installs nothing |
| Wrapper self-resolution loop | fixed and re-tested; no loop |
| Wrapper version-skew warning | fires on mismatch, silenced by `REFACTRON_SKIP_VERSION_CHECK=1` |
| Version single-sourcing | `package.json` 0.3.0; `refactron/__init__.py` 0.3.0 feeding `pyproject.toml` |
| Nothing else hardcodes a version | CLI and MCP server both read `package.json` at runtime |

### Could not be verified locally

- **The published tarball itself.** `npm pack --dry-run` lists what npm intends to ship; it is not the same as fetching the published artifact. Step 17 to 19 in the RUNBOOK cover this after publish and are not optional.
- **`twine upload`.** Never run here. Credentials and the upload path are the founder's.
- **PyPI rendering of the wrapper README.** `twine check` validates the metadata and that the long description parses; it does not render the page. Eyeball https://pypi.org/project/refactron/0.3.0/ after upload.
- **Cross-platform wrapper behavior.** The missing-CLI, loop, and skew paths were exercised on macOS only. The Windows path (`refactron.exe` console script, `os.execvp` shim) is covered by code but not by a run.
- **`vale`** is not installed on this machine, so the docs spellcheck was not run locally. New vocabulary terms (`npx`, `PyPI`, `shim`) were added to `docs/styles/config/vocabularies/Mintlify/accept.txt`; CI is the real check.

---

## What the founder runs

Everything below is blocked locally by policy or requires credentials. Run in order.

```bash
# 0. Land the release branch first (review, merge to main, pull).
git checkout main && git pull origin main

# 1. Re-run the gate on the merged tree. Do not skip: the merge is new code.
npm run prepublishOnly
npm run format:check
npm audit

# 2. Tag.
git tag -a v0.3.0 -m "v0.3.0"
git push origin main --tags

# 3. Dry-run npm and read the file list. Confirm the sidecars:
#      dist/verify/checks/_py/*.py
#      dist/transform/transforms/python/_py/*.py
npm publish --dry-run

# 4. Build and check the PyPI wrapper.
cd refactron-py
rm -rf dist build refactron.egg-info
python3 -m build
python3 -m twine check dist/*
cd ..

# 5. PUSH THE TAG. This IS the release: .github/workflows/release.yml
#    validates the tag against both versions, runs the suite, then publishes
#    to npm and PyPI over OIDC and drafts the GitHub Release. Do NOT publish
#    by hand as well; a second attempt at the same version errors on npm.
git push origin main --tags

# 6. Watch it. If Validate Tag fails, nothing publishes and every later job
#    is skipped, so fix on main, delete the tag both places, and re-tag.
gh run watch $(gh run list --workflow Release --limit 1 --json databaseId --jq '.[0].databaseId')

# 7. Review the drafted GitHub Release. Replace the generated commit list with
#    the CHANGELOG [0.3.0] section, lead with the repositioning rather than the
#    bullets, then publish it. Humans read this page.

# 8. Verify npm.
cd /tmp && rm -rf verify-release && mkdir verify-release && cd verify-release
npm init -y && npm install refactron@0.3.0
npx refactron --version                                              # 0.3.0
ls node_modules/refactron/dist/verify/checks/_py/                    # non-empty
ls node_modules/refactron/dist/transform/transforms/python/_py/      # non-empty
ls node_modules/.bin/refactron-mcp                                   # exists

# 9. Verify pip.
cd /tmp && rm -rf verify-pip && python3 -m venv verify-pip
./verify-pip/bin/pip install refactron==0.3.0
./verify-pip/bin/refactron --version                                 # 0.3.0

# 10. Verify the pip failure path, which is the one users hit.
#     With npm's global bin off PATH, the wrapper must print
#     `npm install -g refactron@0.3.0`, exit non-zero, install nothing,
#     and NOT loop.
env -i HOME="$HOME" PATH="/tmp/verify-pip/bin:$(dirname $(which node)):/usr/bin:/bin" \
  /tmp/verify-pip/bin/refactron --help; echo "exit=$?"
```

---

## Hold for later, do not batch into this release

- **Dependabot #48 (production group) and #5 (dev group) are NOT redundant** with the `npm audit fix` lockfile change on this branch. That fix moved transitive versions only, inside existing ranges. Both PRs are major-range bumps and each is a migration, not a version bump:
  - #48: `commander` 12 to 15, `react` 18 to 19, `ts-morph` 22 to 28, `glob` 10 to 13, `execa` 8 to 9, `diff` 5 to 9, `js-yaml` 4 to 5, `write-file-atomic` 5 to 8, `tree-sitter` 0.21 to 0.25.
  - #5: `eslint` 8 to 10 (requires the flat-config migration and drops `--ext`, which `npm run lint` uses), `vitest` 3 to 4, `@types/node` 20 to 26, `typescript-eslint` 7 to 8, `rimraf` 5 to 6.

  `ts-morph` and `tree-sitter` are transform-behavior-bearing; `react` 19 against `ink` 5 is unproven here. Take them one dependency per PR after 0.3.0 is out, with the suite as the oracle.
- **`docs/reference/performance.mdx`** still says "Refactron 0.2.x" (line 17) and "Performance targets (v0.2 release gate)" (line 67). These are historical measurements, not availability claims. Relabeling them to 0.3.0 without re-running `bench/` would be fabrication. Re-run the bench and update, or leave them as dated 0.2 numbers.
- **Stale scope comments in Python sidecars.** Several `_py/*.py` files say "conservative scope for v0.3.0" for transforms that actually shipped in 0.2.3 (the release renumbered `0.3.0` to `0.2.3` in commit 04da46d). Internal comments only, no user impact, but they will confuse the next reader of those files.
- **`refactron-mcp` has no PyPI console script.** Considered and declined: the wrapper hard-requires the npm package, and installing that already puts `refactron-mcp` on PATH. Adding a second pip entry point would create a permanent public surface for zero reach. The docs say plainly that the MCP server comes from npm.

---

## Rollback

npm and PyPI have different rules and the RUNBOOK now covers both. The short version: npm cannot be unpublished past 72h and should not be; PyPI can never re-upload a filename at all, but a release can be **yanked** (hidden from resolution, still installable by exact pin). Either way the fix is 0.3.1, shipped to both registries in the same npm-then-pip order.
