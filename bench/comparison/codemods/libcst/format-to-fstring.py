"""LibCST runner: invoke Instagram's reference ConvertFormatStringCommand.

Zero custom transformation logic — we delegate to LibCST's built-in command,
which is the reference impl. This is intentional: it represents the
"stock LibCST" cell in the comparison, with no per-fixture tuning.

Usage:
    python3 bench/comparison/codemods/libcst/format-to-fstring.py <fixture-dir>

The script edits files in place. Files that the command cannot rewrite are
left untouched (LibCST does this safely; that's a `missed` data point, not
a failure).
"""

from __future__ import annotations

import sys
from pathlib import Path

from libcst.codemod import CodemodContext
from libcst.codemod.commands.convert_format_to_fstring import (
    ConvertFormatStringCommand,
)
import libcst as cst


def rewrite_file(path: Path) -> None:
    source = path.read_text()
    try:
        mod = cst.parse_module(source)
    except cst.ParserSyntaxError as exc:
        print(f"[skip] {path}: parse error: {exc}", file=sys.stderr)
        return

    ctx = CodemodContext()
    command = ConvertFormatStringCommand(ctx)
    try:
        new_mod = command.transform_module(mod)
    except Exception as exc:  # noqa: BLE001 -- replicate stock command behavior
        print(f"[skip] {path}: codemod error: {exc}", file=sys.stderr)
        return

    if new_mod.code != source:
        path.write_text(new_mod.code)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: format-to-fstring.py <fixture-dir>", file=sys.stderr)
        return 2
    root = Path(argv[1])
    if not root.is_dir():
        print(f"not a directory: {root}", file=sys.stderr)
        return 2
    py_files = [p for p in sorted(root.iterdir()) if p.suffix == ".py"]
    for p in py_files:
        rewrite_file(p)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
