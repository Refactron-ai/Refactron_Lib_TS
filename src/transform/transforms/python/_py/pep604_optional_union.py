"""PEP 604: rewrite ``Optional[X]`` -> ``X | None`` and
``Union[A, B, ...]`` -> ``A | B | ...`` (Python >= 3.10).

Scope:
  * Handles both ``typing.Optional[X]`` / ``typing.Union[...]`` and the
    bare-name form via ``from typing import Optional, Union``.
  * Edge cases:
      - ``Union[A]`` (single arg) unwraps to ``A``.
      - ``Union[A, None]`` becomes ``A | None`` (None placed last for
        readability).
      - ``Optional[Optional[X]]`` collapses to ``X | None``.
      - ``Optional[Union[A, B]]`` collapses to ``A | B | None``.
  * De-duplicates None occurrences.

Version gate:
  * Refuses with `python_version_too_low` when the project's resolved Python
    version is < 3.10, UNLESS ``from __future__ import annotations`` is
    present (PEP 563 defers evaluation, so PEP 604 syntax is valid on
    Python 3.7+ in annotation positions).

Runtime-eval precondition:
  * Same conservative refusal as ``pep585_generics``: Pydantic v1 or
    ``typing.get_type_hints`` without ``__future__.annotations``.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _base import read_source, emit  # noqa: E402
from _cross_file import load_cross_file  # noqa: E402
from _python_version import at_least  # noqa: E402
from _typing_cleanup import (  # noqa: E402
    is_future_annotations,
    has_runtime_type_eval_risk,
    cleanup_typing_imports,
    isinstance_uses_target,
)

import libcst as cst  # noqa: E402


TARGETS = {"Optional", "Union"}


def _collect_typing_aliases(module: cst.Module):
    """Return (module_aliases, bare_names) where:
      - module_aliases: set of local names bound to the `typing` module.
      - bare_names: set of TARGETS imported via `from typing import X`
        (bare or no-op-aliased form only).
    """
    module_aliases: set[str] = set()
    bare_names: set[str] = set()
    for stmt in module.body:
        if not isinstance(stmt, cst.SimpleStatementLine):
            continue
        for small in stmt.body:
            if isinstance(small, cst.Import):
                for alias in small.names:
                    if isinstance(alias.name, cst.Name) and alias.name.value == "typing":
                        if alias.asname is not None and isinstance(alias.asname.name, cst.Name):
                            module_aliases.add(alias.asname.name.value)
                        else:
                            module_aliases.add("typing")
            elif isinstance(small, cst.ImportFrom):
                mod = small.module
                if not (isinstance(mod, cst.Name) and mod.value == "typing"):
                    continue
                if isinstance(small.names, cst.ImportStar):
                    for canonical in TARGETS:
                        bare_names.add(canonical)
                    continue
                for alias in small.names:
                    if not isinstance(alias.name, cst.Name):
                        continue
                    canonical = alias.name.value
                    if canonical not in TARGETS:
                        continue
                    if alias.asname is None:
                        bare_names.add(canonical)
                    else:
                        bound = alias.asname.name
                        if isinstance(bound, cst.Name) and bound.value == canonical:
                            bare_names.add(canonical)
    return module_aliases, bare_names


def _is_none(expr: cst.BaseExpression) -> bool:
    return isinstance(expr, cst.Name) and expr.value == "None"


def _expr_key(expr: cst.BaseExpression) -> str:
    """Best-effort dedup key for union args. Uses the libcst.Module().code_for_node
    rendering when available, falls back to repr.
    """
    try:
        return cst.Module(body=[]).code_for_node(expr).strip()
    except Exception:
        return repr(expr)


class _Rewriter(cst.CSTTransformer):
    def __init__(self, module_aliases: set[str], bare_names: set[str]):
        self.module_aliases = module_aliases
        self.bare_names = bare_names
        self.changed = False
        # Names from `from typing import ...` we'd like the cleanup pass to
        # consider for removal.
        self.rewrote_typing_names: set[str] = set()

    def _classify(self, value: cst.BaseExpression):
        """Return (canonical_name, was_bare) when `value` is one of our targets.
        Otherwise (None, _)."""
        if isinstance(value, cst.Name):
            if value.value in self.bare_names:
                return value.value, True
            return None, False
        if isinstance(value, cst.Attribute):
            base = value.value
            if (
                isinstance(base, cst.Name)
                and base.value in self.module_aliases
                and value.attr.value in TARGETS
            ):
                return value.attr.value, False
        return None, False

    def _subscript_args(self, sub: cst.Subscript):
        """Return the list of argument expressions inside a subscript (Subscript
        slices are a list of SubscriptElement); skip any with a Slice (Index
        only, which is the typical typing usage)."""
        out: list[cst.BaseExpression] = []
        for el in sub.slice:
            if isinstance(el.slice, cst.Index):
                out.append(el.slice.value)
        return out

    def _collapse(self, expr: cst.BaseExpression) -> list[cst.BaseExpression]:
        """Recursively flatten Optional/Union expressions into a list of
        component types. Already-rewritten BinaryOperation (`A | B`) is also
        flattened so nested rewrites collapse cleanly. None survives as a
        Name('None') element which the caller de-dupes."""
        # If it's a Subscript on Optional/Union, recurse.
        if isinstance(expr, cst.Subscript):
            canonical, _ = self._classify(expr.value)
            if canonical == "Optional":
                inner = self._subscript_args(expr)
                # Optional must have exactly one arg per spec; tolerate the
                # extra-args case by treating later args as additional types.
                out: list[cst.BaseExpression] = []
                for a in inner:
                    out.extend(self._collapse(a))
                out.append(cst.Name("None"))
                return out
            if canonical == "Union":
                inner = self._subscript_args(expr)
                out = []
                for a in inner:
                    out.extend(self._collapse(a))
                return out
        # Flatten an existing `A | B` (after a prior rewrite at a deeper level).
        if isinstance(expr, cst.BinaryOperation) and isinstance(expr.operator, cst.BitOr):
            return self._collapse(expr.left) + self._collapse(expr.right)
        return [expr]

    def _build_pipe(self, components: list[cst.BaseExpression]) -> cst.BaseExpression:
        """Build a left-associative ``A | B | C`` BinaryOperation chain. None
        is moved to the end if present, to match the convention readers expect.
        Single-element list returns the element unchanged."""
        # Dedup by code rendering — keep first occurrence.
        seen: set[str] = set()
        uniq: list[cst.BaseExpression] = []
        for c in components:
            k = _expr_key(c)
            if k in seen:
                continue
            seen.add(k)
            uniq.append(c)
        # Move None to the end.
        nones = [c for c in uniq if _is_none(c)]
        non_nones = [c for c in uniq if not _is_none(c)]
        ordered = non_nones + nones
        if len(ordered) == 1:
            return ordered[0]
        out: cst.BaseExpression = ordered[0]
        for nxt in ordered[1:]:
            out = cst.BinaryOperation(
                left=out,
                operator=cst.BitOr(
                    whitespace_before=cst.SimpleWhitespace(" "),
                    whitespace_after=cst.SimpleWhitespace(" "),
                ),
                right=nxt,
            )
        return out

    def leave_Subscript(
        self, original: cst.Subscript, updated: cst.Subscript
    ) -> cst.BaseExpression:
        canonical, was_bare = self._classify(updated.value)
        if canonical is None:
            return updated
        components = self._collapse(updated)
        if not components:
            return updated
        # Build the replacement.
        new_node = self._build_pipe(components)
        self.changed = True
        if was_bare:
            self.rewrote_typing_names.add(canonical)
        return new_node


def main():
    if len(sys.argv) < 2:
        emit(ok=False, error="usage: pep604_optional_union.py <file> [cross_file_json]")
        return
    path_ = sys.argv[1]
    cross_file = load_cross_file(2)
    src = read_source(path_)

    try:
        module = cst.parse_module(src)
    except cst.ParserSyntaxError as e:
        emit(ok=False, error=f"parse error: {e}")
        return

    future_ann = is_future_annotations(module)
    version_ok = at_least(cross_file, 3, 10)

    # Mirror the pep585 runtime-subscript guard: if we're only proceeding
    # because of the `__future__` annotations override on a < 3.10 interpreter,
    # refuse files that use Optional / Union subscripts in a runtime
    # expression (e.g. `isinstance(x, Union[int, str])`) — the rewritten
    # `int | str` form is not a valid second arg to `isinstance` on Python
    # < 3.10.
    if future_ann and not version_ok and isinstance_uses_target(module, TARGETS):
        emit(
            ok=True,
            new_content="",
            preconditions=[
                {
                    "id": "runtime_subscript_unsafe",
                    "satisfied": False,
                    "reason": (
                        "file uses `isinstance(..., Optional[...] / Union[...])`; "
                        "the rewritten `A | B` form is not a valid runtime "
                        "type expression on Python < 3.10 (the "
                        "`from __future__ import annotations` override covers "
                        "annotations only, not runtime expressions)"
                    ),
                }
            ],
        )
        return

    if not future_ann and not version_ok:
        emit(
            ok=True,
            new_content="",
            preconditions=[
                {
                    "id": "python_version_too_low",
                    "satisfied": False,
                    "reason": (
                        "pep604_optional_union requires Python >= 3.10 (or "
                        "`from __future__ import annotations`); project's "
                        "minimum version is unset or older."
                    ),
                }
            ],
        )
        return

    risk = has_runtime_type_eval_risk(module)
    if risk is not None:
        emit(
            ok=True,
            new_content="",
            preconditions=[
                {
                    "id": "runtime_type_eval_unsafe",
                    "satisfied": False,
                    "reason": risk,
                }
            ],
        )
        return

    module_aliases, bare_names = _collect_typing_aliases(module)
    if not module_aliases and not bare_names:
        emit(ok=True, new_content="", preconditions=[])
        return

    rewriter = _Rewriter(module_aliases, bare_names)
    new_module = module.visit(rewriter)
    if not rewriter.changed:
        emit(ok=True, new_content="", preconditions=[])
        return

    # Cleanup — drop now-unused Optional / Union typing imports. No abc / re
    # additions for this transform.
    new_module = cleanup_typing_imports(
        new_module,
        removed_typing_names=rewriter.rewrote_typing_names,
    )

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
