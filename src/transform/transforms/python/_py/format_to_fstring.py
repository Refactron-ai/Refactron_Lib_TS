import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _base import read_source, emit  # noqa: E402

import libcst as cst  # noqa: E402
from libcst.codemod import CodemodContext  # noqa: E402
from libcst.codemod.commands.convert_format_to_fstring import (  # noqa: E402
    ConvertFormatStringCommand,
)

# Refactron's own printf-grammar percent-format converter. It supersedes
# LibCST's ConvertPercentFormatStringCommand, which only converts plain %s
# and silently skips %d/%f/%x/width/precision/%% etc. We therefore do NOT
# chain the LibCST percent command anymore -- our converter is a strict
# superset for the cases LibCST handled (plain %s) and covers far more.
from _percent_format import convert_percent_formats  # noqa: E402


def _run_command(cmd, module: cst.Module) -> cst.Module:
    # LibCST's CodemodCommand exposes ``transform_module`` (not ``visit``) as
    # the supported entry-point for running a codemod against a parsed module.
    return cmd.transform_module(module)


def main():
    if len(sys.argv) < 2:
        emit(ok=False, error="usage: format_to_fstring.py <file>")
        return
    path = sys.argv[1]
    src = read_source(path)
    try:
        module = cst.parse_module(src)
    except cst.ParserSyntaxError as e:
        emit(ok=False, error=f"parse error: {e}")
        return

    preconditions = []
    current = module

    # Pass 1: LibCST's .format() -> f-string codemod (kept as-is).
    try:
        current = _run_command(ConvertFormatStringCommand(CodemodContext()), current)
    except Exception as e:  # unsupported pattern; record and continue
        preconditions.append(
            {
                "id": "format-command",
                "satisfied": False,
                "reason": f"ConvertFormatStringCommand failed: {e}",
            }
        )

    # Pass 2: Refactron's printf-grammar percent-format -> f-string converter.
    try:
        current = convert_percent_formats(current)
    except Exception as e:
        preconditions.append(
            {
                "id": "percent-format-command",
                "satisfied": False,
                "reason": f"percent-format converter failed: {e}",
            }
        )

    if current.code == src:
        # No change — leave source untouched.
        emit(ok=True, new_content="", preconditions=preconditions)
        return

    preconditions.append({"id": "converted", "satisfied": True})
    emit(ok=True, new_content=current.code, preconditions=preconditions)


if __name__ == "__main__":
    main()
