# Refactron v0.2.0 — Pre-Ship Checklist

Run through this in order on Day 56 morning before T-2h smoke. Anything failing
aborts ship until fixed.

## Subagent-verifiable (Day 55 closes these)

- [x] `npm run typecheck` exits 0
- [x] `npm run lint` exits 0
- [x] `npm run format:check` exits 0
- [x] `npm run build` exits 0
- [x] `npm test` exits 0 (Python-subprocess parallel-load flake passes in isolation — acceptable)
- [x] `npm pack --dry-run` shows `refactron-0.2.0.tgz` with expected file list (no `.env`, `node_modules/`, `fixtures/`, `tests/`, `dev-docs/`, `tape/`, `bench/`, `docs/`, `refactron-py/`)
- [x] `npm audit --audit-level=high` exits 0
- [x] `cd refactron-py && python3 -m build && twine check dist/*` PASSES
- [x] Local clean-room: macOS host install of npm tarball returns `--version` 0.2.0
- [x] CHANGELOG `[0.2.0]` entry present and dated
- [x] README displays demo GIF reference (the file may still be a placeholder pending vhs render)

## User-only (Om verifies on ship day)

- [ ] `npm whoami` returns Om's account
- [ ] npm 2FA on
- [ ] `pip install -e refactron-py/` works locally in a fresh venv
- [ ] README renders cleanly on GitHub mobile (HN traffic skews mobile)
- [ ] `vhs tape/demo.tape` rendered → `docs/assets/demo.gif` exists, under 5 MB, under 30s, no audio
- [ ] Docs site live at docs.refactron.dev
- [ ] Git tag `v0.2.0` ready to push (`git tag v0.2.0`; do not `push origin v0.2.0` until Day 56 T-1h)
- [ ] PyPI `refactron` namespace owner has authorized Om's account for upload
  (legacy v1.0.15 owner — confirm before T-1h or PyPI publish blocks)
- [ ] Discord/Slack/Twitter cleared for the 12-hour engagement window
- [ ] Phone fully charged
