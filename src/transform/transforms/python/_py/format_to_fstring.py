import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _base import read_source, emit  # noqa: E402

import libcst as cst  # noqa: E402
from libcst.codemod import CodemodContext  # noqa: E402
from libcst.codemod.commands.convert_format_to_fstring import (  # noqa: E402
    ConvertFormatStringCommand,
)

try:
    from libcst.codemod.commands.convert_percent_format_to_fstring import (  # noqa: E402
        ConvertPercentFormatStringCommand,
    )
except Exception:  # pragma: no cover - older libcst versions
    ConvertPercentFormatStringCommand = None  # type: ignore[assignment]


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

    if ConvertPercentFormatStringCommand is not None:
        try:
            current = _run_command(
                ConvertPercentFormatStringCommand(CodemodContext()), current
            )
        except Exception as e:
            preconditions.append(
                {
                    "id": "percent-format-command",
                    "satisfied": False,
                    "reason": f"ConvertPercentFormatStringCommand failed: {e}",
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
