"""`for X in Y: yield X` -> `yield from Y`.

`yield from` has been available since Python 3.3, so no version gate is
needed -- every interpreter we support has it.

Scope (intentionally narrow for v0.3.0):
- Rewrites only `cst.For` nodes where ALL of these hold:
    * `target` is a single `Name` (skip tuple targets `for x, y in z:`).
    * `body` is exactly one `SimpleStatementLine` whose sole small-statement is
      `Expr(Yield)`, AND the yielded value is `Name(<loop-var>)`.
    * No `orelse` (no `else:` branch -- Python's `for/else` executes the else
      block when the loop completes without `break`, and `yield from` does
      NOT preserve that semantics).
    * Not already a `yield from <iter>` form (no-op rewrite, skip cleanly).

- Preserves the loop's leading lines (comments above the `for`) by reusing
  the For node's `leading_lines`. Inline comments on the `for` line are
  attached to the new `yield from` statement's trailing whitespace.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _base import read_source, emit  # noqa: E402

import libcst as cst  # noqa: E402


def _is_target_for(node: cst.For) -> bool:
    """Return True iff the For node matches the rewrite shape."""
    # else: branch -> bail.
    if node.orelse is not None:
        return False
    # Loop variable must be a single Name.
    if not isinstance(node.target, cst.Name):
        return False
    # Body must be a single-line block containing exactly one small statement,
    # which must be `Expr(Yield(<loop-var>))`. We allow only the indented-block
    # form -- LibCST surfaces single-line `for x in y: yield x` as a
    # `SimpleStatementSuite` (no IndentedBlock), so handle both.
    body = node.body
    small_statements: list = []
    if isinstance(body, cst.IndentedBlock):
        if len(body.body) != 1:
            return False
        line = body.body[0]
        if not isinstance(line, cst.SimpleStatementLine):
            return False
        small_statements = list(line.body)
    elif isinstance(body, cst.SimpleStatementSuite):
        small_statements = list(body.body)
    else:
        return False

    if len(small_statements) != 1:
        return False
    only = small_statements[0]
    if not isinstance(only, cst.Expr):
        return False
    yld = only.value
    if not isinstance(yld, cst.Yield):
        return False
    # Skip already-`yield from`. LibCST models that as Yield(value=From(...))
    # via cst.From only when present; the simpler way to distinguish is
    # checking whether `yld.value` is itself a From node. In LibCST,
    # `yield from x` is `Yield(value=From(item=...))`.
    if isinstance(yld.value, cst.From):
        return False
    # Yielded value must be the bare loop variable.
    if not isinstance(yld.value, cst.Name):
        return False
    target_name = node.target  # cst.Name asserted above
    assert isinstance(target_name, cst.Name)
    if yld.value.value != target_name.value:
        return False
    return True


class _ForToYieldFrom(cst.CSTTransformer):
    def __init__(self):
        self.changed = False
        # Track enclosing `async def` scopes. `yield from` is a SyntaxError
        # inside an async function (CPython 3.7+: "'yield from' inside async
        # function"). LibCST's *parser* accepts it -- the restriction is
        # enforced by CPython's compile step, NOT by the grammar -- so our
        # round-trip defensive parse below would silently let corrupted code
        # through. Skip rewrites under any enclosing `async def`.
        # TODO(pep828): re-evaluate async-def gate when PEP 828 lands.
        self._async_depth = 0

    def visit_FunctionDef(self, node: cst.FunctionDef) -> bool:
        if node.asynchronous is not None:
            self._async_depth += 1
        return True

    def leave_FunctionDef(
        self, original: cst.FunctionDef, updated: cst.FunctionDef
    ) -> cst.FunctionDef:
        if original.asynchronous is not None:
            self._async_depth -= 1
        return updated

    def leave_For(self, original: cst.For, updated: cst.For):
        if self._async_depth > 0:
            # Inside `async def`: `yield from` is a SyntaxError. A `for x in
            # seq: yield x` here makes the function an async generator (PEP
            # 525); we must NOT rewrite it.
            return updated
        if not _is_target_for(updated):
            return updated

        iter_expr = updated.iter

        # Build `yield from <iter>` as a Yield(value=From(item=iter_expr)).
        # We must wrap From's `item` with a leading space so the rendered code
        # is `yield from x` and not `yield fromx` -- LibCST's From handles
        # this for us through its own whitespace defaults, but be explicit so
        # the round-trip is robust.
        new_yield = cst.Yield(
            value=cst.From(
                item=iter_expr,
                whitespace_after_from=cst.SimpleWhitespace(" "),
            ),
        )
        new_expr = cst.Expr(value=new_yield)

        # Preserve the leading lines of the original For statement (comments
        # immediately above it). We rebuild as a SimpleStatementLine so the
        # `yield from <iter>` is emitted at the For's indent.
        leading_lines = updated.leading_lines

        # If the body was a single-line for-suite with a trailing comment on
        # the same line as `yield x`, try to preserve it on the new line.
        trailing_whitespace = cst.TrailingWhitespace()
        if isinstance(updated.body, cst.IndentedBlock):
            inner_line = updated.body.body[0]
            if isinstance(inner_line, cst.SimpleStatementLine):
                trailing_whitespace = inner_line.trailing_whitespace
        elif isinstance(updated.body, cst.SimpleStatementSuite):
            # Single-line form `for x in seq: yield x  # comment`: the
            # SimpleStatementSuite carries the trailing whitespace/comment.
            trailing_whitespace = updated.body.trailing_whitespace

        new_stmt = cst.SimpleStatementLine(
            body=[new_expr],
            leading_lines=leading_lines,
            trailing_whitespace=trailing_whitespace,
        )

        self.changed = True
        return new_stmt


def main():
    if len(sys.argv) < 2:
        emit(ok=False, error="usage: yield_from_for_loop.py <file>")
        return
    path_ = sys.argv[1]
    src = read_source(path_)

    try:
        module = cst.parse_module(src)
    except cst.ParserSyntaxError as e:
        emit(ok=False, error=f"parse error: {e}")
        return

    transformer = _ForToYieldFrom()
    new_module = module.visit(transformer)
    if not transformer.changed:
        emit(ok=True, new_content="", preconditions=[])
        return

    # Defensive parse: ensure our rewritten output round-trips. If parsing
    # fails, refuse rather than emit corrupted source.
    try:
        cst.parse_module(new_module.code)
    except cst.ParserSyntaxError as e:
        emit(
            ok=True,
            new_content="",
            preconditions=[
                {
                    "id": "rewrite_unparseable",
                    "satisfied": False,
                    "reason": f"rewritten module did not round-trip: {e}",
                }
            ],
        )
        return

    if new_module.code == src:
        emit(ok=True, new_content="", preconditions=[])
        return

    emit(
        ok=True,
        new_content=new_module.code,
        preconditions=[{"id": "rewritten", "satisfied": True}],
    )


if __name__ == "__main__":
    main()
