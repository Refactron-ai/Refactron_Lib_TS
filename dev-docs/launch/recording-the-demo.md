# Recording the README demo GIF

The README references `docs/assets/demo.gif`, which is generated from
`tape/demo.tape` using [vhs](https://github.com/charmbracelet/vhs).

Generation is deferred to the maintainer because vhs is a one-time Homebrew
install and the recording requires a built `dist/` on `PATH`.

## One-time setup

```bash
brew install vhs
```

vhs depends on `ffmpeg` and `ttyd`; Homebrew pulls those in automatically.

## Recording

From the repo root:

```bash
# 1. Build the CLI so the global `refactron` symbol points at this tree.
npm run build

# 2. Make the local build globally available (or skip if it already is).
npm install -g .

# 3. Render the GIF.
vhs tape/demo.tape

# 4. Verify size — must be under 5 MB for the README.
ls -lh docs/assets/demo.gif
```

If the GIF exceeds 5 MB, edit `tape/demo.tape`:

- Lower `Width` to `720` or `Height` to `480`.
- Lower `FontSize` to `12`.
- Drop the `refactron document --apply` step (the launch GIF can show the
  refactor flow without docs; users find `document` via the docs site).

## Cleanup

After recording, optionally:

```bash
npm uninstall -g refactron   # if you don't want the local build globally
```

## Why this isn't automated in CI

vhs needs a real PTY and a Homebrew-managed binary stack; running it inside
GitHub Actions reliably is more setup than the once-per-launch cadence
justifies. The tape script is checked in, so anyone with vhs locally can
re-render in under a minute.
