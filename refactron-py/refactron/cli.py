"""Detect Node.js, ensure the npm refactron CLI is available, then exec it."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys


REQUIRED_NODE_MAJOR = 18
NPM_PACKAGE = "refactron"


def _have(cmd: str) -> bool:
    return shutil.which(cmd) is not None


def _node_version_ok() -> bool:
    try:
        out = subprocess.check_output(["node", "--version"], text=True).strip()
        # "v20.11.1" -> 20
        major = int(out.lstrip("v").split(".")[0])
        return major >= REQUIRED_NODE_MAJOR
    except (subprocess.SubprocessError, ValueError, OSError):
        return False


def _ensure_npm_cli() -> str:
    """Return the absolute path to the `refactron` CLI executable.

    If `refactron` is on PATH, use it. Otherwise install via `npm install -g`
    (best-effort) and re-check. If still missing, raise."""
    if _have("refactron"):
        return shutil.which("refactron")  # type: ignore[return-value]

    # Try a one-shot global install via npm.
    if _have("npm"):
        subprocess.check_call(["npm", "install", "-g", NPM_PACKAGE], stdout=sys.stderr)
        if _have("refactron"):
            return shutil.which("refactron")  # type: ignore[return-value]

    raise SystemExit(
        "refactron: the underlying Node CLI is not installed. "
        "Run `npm install -g refactron` or use `npx refactron` directly."
    )


def main() -> "int | None":
    if not _have("node"):
        print(
            "refactron: Node.js 18+ is required. Install Node from https://nodejs.org "
            "or use a version manager like nvm.",
            file=sys.stderr,
        )
        return 1
    if not _node_version_ok():
        print(
            f"refactron: Node.js {REQUIRED_NODE_MAJOR}+ required (you have an older version).",
            file=sys.stderr,
        )
        return 1

    cli = _ensure_npm_cli()
    # exec replaces this process so signals (Ctrl+C) and exit codes pass
    # through cleanly. On Windows os.execvp is shimmed; if it fails we fall
    # back to subprocess.run so the user still gets a usable CLI.
    args = [cli, *sys.argv[1:]]
    try:
        os.execvp(cli, args)
    except OSError:
        completed = subprocess.run(args)
        return completed.returncode


if __name__ == "__main__":
    sys.exit(main() or 0)
