"""Locate the Refactron Node CLI and exec it.

This wrapper never installs anything. It resolves the `refactron` binary that
npm provides, warns if that binary's version disagrees with this package's,
and hands the process over. If the Node CLI is missing it prints the exact
command that installs the matching version and exits non-zero.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import sysconfig

from . import __version__

REQUIRED_NODE_MAJOR = 18
NPM_PACKAGE = "refactron"
NPM_BIN = "refactron"

# Set on the child environment before exec. If it is already set when we start,
# we resolved ourselves instead of the Node CLI and would otherwise exec in a
# loop forever.
_REENTRY_ENV = "_REFACTRON_PY_SHIM"

# Opt out of the one-shot `refactron --version` skew check.
_SKIP_VERSION_CHECK_ENV = "REFACTRON_SKIP_VERSION_CHECK"

_VERSION_CHECK_TIMEOUT_SECONDS = 10


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


def _realpath(path: str) -> str:
    try:
        return os.path.realpath(path)
    except OSError:
        return path


def _own_entry_points() -> set:
    """Paths that would re-enter this wrapper instead of reaching the Node CLI.

    pip installs a console script named `refactron`, and in a virtualenv that
    directory sits ahead of npm's global bin on PATH. Resolving the name
    naively finds our own script and execs it, forever.
    """
    paths = set()

    argv0 = sys.argv[0] if sys.argv else ""
    if argv0:
        paths.add(_realpath(argv0))

    for scheme_arg in (None, "posix_user", "nt_user"):
        try:
            scripts_dir = (
                sysconfig.get_path("scripts")
                if scheme_arg is None
                else sysconfig.get_path("scripts", scheme=scheme_arg)
            )
        except (KeyError, ValueError):
            continue
        if not scripts_dir:
            continue
        for name in (NPM_BIN, NPM_BIN + ".exe"):
            paths.add(_realpath(os.path.join(scripts_dir, name)))

    return paths


def _is_python_script(path: str) -> bool:
    """True when `path` is a Python console script rather than the Node CLI."""
    try:
        with open(path, "rb") as handle:
            head = handle.read(256)
    except OSError:
        return False
    if not head.startswith(b"#!"):
        return False
    shebang = head.split(b"\n", 1)[0].lower()
    return b"python" in shebang


def _find_node_cli() -> str | None:
    """Return the npm-provided `refactron` binary, skipping our own shim."""
    own = _own_entry_points()
    for directory in os.environ.get("PATH", "").split(os.pathsep):
        if not directory:
            continue
        candidate = shutil.which(NPM_BIN, path=directory)
        if not candidate:
            continue
        if _realpath(candidate) in own:
            continue
        if _is_python_script(candidate):
            continue
        return candidate
    return None


def _missing_cli_message() -> str:
    return (
        "refactron: the Node CLI that does the real work is not installed.\n"
        "\n"
        "Install the version that matches this Python package:\n"
        f"    npm install -g {NPM_PACKAGE}@{__version__}\n"
        "\n"
        "Or run it without installing:\n"
        f"    npx {NPM_PACKAGE}@{__version__} --help\n"
        "\n"
        f"This wrapper (refactron {__version__}) is a thin shim and deliberately\n"
        "does not install npm packages for you."
    )


def _cli_version(cli: str) -> str | None:
    """Best-effort `refactron --version`. Never raises, never blocks for long."""
    try:
        completed = subprocess.run(
            [cli, "--version"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=_VERSION_CHECK_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode != 0:
        return None
    try:
        reported = completed.stdout.decode("utf-8", "replace").strip()
    except (AttributeError, UnicodeError):
        return None
    return reported.lstrip("vV") or None


def _warn_on_version_skew(cli: str) -> None:
    if os.environ.get(_SKIP_VERSION_CHECK_ENV):
        return
    found = _cli_version(cli)
    if found is None or found == __version__:
        return
    print(
        f"refactron: version skew. This Python wrapper is {__version__} but the "
        f"Node CLI on your PATH is {found}.\n"
        f"           Align them with `npm install -g {NPM_PACKAGE}@{__version__}`, "
        f"or set {_SKIP_VERSION_CHECK_ENV}=1 to silence this.",
        file=sys.stderr,
    )


def main() -> int | None:
    if os.environ.get(_REENTRY_ENV):
        print(
            "refactron: the Python wrapper resolved itself instead of the Node "
            "CLI, so it stopped rather than loop.\n"
            f"Install the Node CLI with `npm install -g {NPM_PACKAGE}@{__version__}` "
            "and make sure npm's global bin directory is on your PATH.",
            file=sys.stderr,
        )
        return 1

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

    cli = _find_node_cli()
    if cli is None:
        print(_missing_cli_message(), file=sys.stderr)
        return 1

    # Set the sentinel before anything spawns `cli`, not just before the exec.
    # If resolution ever handed back our own script despite the filtering above,
    # the version probe would fork-bomb rather than merely loop. The child sees
    # the sentinel and exits immediately.
    os.environ[_REENTRY_ENV] = __version__

    _warn_on_version_skew(cli)

    # exec replaces this process so signals (Ctrl+C) and exit codes pass
    # through cleanly. On Windows os.execvp is shimmed; if it fails we fall
    # back to subprocess.run so the user still gets a usable CLI.
    args = [cli, *sys.argv[1:]]
    try:
        os.execvp(cli, args)
    except OSError:
        completed = subprocess.run(args)
        return completed.returncode
    return None


if __name__ == "__main__":
    sys.exit(main() or 0)
