"""Shared helpers for the PEP 585 / PEP 604 transforms.

Both transforms need to:
  1. Detect `from __future__ import annotations` (which makes annotations
     deferred / string-eval-only — so the new generics / union syntax are
     valid on *any* Python version, regardless of the runtime gate).
  2. Refuse files where annotations are evaluated at runtime in a way that
     would break under the new syntax on 3.9 / 3.10 (Pydantic v1, an explicit
     `typing.get_type_hints` call without `__future__.annotations`).
  3. Drop / rewrite `from typing import ...` entries once the rewriter has
     consumed them, optionally adding the right `collections.abc` / `re`
     replacements alongside.

Exported surface — keep it small (3 functions):
    is_future_annotations(module) -> bool
    has_runtime_type_eval_risk(module) -> str | None  # reason or None
    cleanup_typing_imports(
        module,
        removed_typing_names: set[str],
        add_collections_abc: set[str] | None = None,
        add_re_names: set[str] | None = None,
    ) -> cst.Module
"""

from __future__ import annotations

import libcst as cst
import libcst.matchers as m


# ---------------------------------------------------------------------------
# Detection helpers


def is_future_annotations(module: cst.Module) -> bool:
    """True iff the module's top-of-file imports include
    `from __future__ import annotations`.

    PEP 563 makes annotations strings at runtime, so PEP 585 / 604 syntax is
    valid in annotation positions on any Python >= 3.7 even though the runtime
    subscripting / `|` operator was added in 3.9 / 3.10. The version gate is
    therefore lifted whenever this import is present.
    """
    # TODO(v0.4): per PEP 236 the `__future__` import is only effective when it
    # appears before any non-docstring statement. We currently accept it
    # anywhere in module.body, so a mis-positioned `from __future__ import
    # annotations` (which Python would actually reject) would still flip our
    # bypass on. Tighten by scanning only leading docstring + __future__ block.
    for stmt in module.body:
        if not isinstance(stmt, cst.SimpleStatementLine):
            continue
        for small in stmt.body:
            if not isinstance(small, cst.ImportFrom):
                continue
            mod = small.module
            if not (isinstance(mod, cst.Name) and mod.value == "__future__"):
                continue
            if isinstance(small.names, cst.ImportStar):
                continue
            for alias in small.names:
                if isinstance(alias.name, cst.Name) and alias.name.value == "annotations":
                    return True
    return False


def has_runtime_type_eval_risk(module: cst.Module) -> str | None:
    """Detect patterns where annotations are evaluated at runtime in a way that
    would break under the new lowercase-generics / X|None syntax on 3.9 / 3.10.

    Conservative — over-skip beats under-skip:
      * Pydantic v1 (`from pydantic import BaseModel` with no v2 markers).
        Pydantic v1 walks annotations at runtime via `get_type_hints`. Even
        when the source is using `typing.List[...]`, replacing it with
        `list[...]` only works at runtime on Python 3.9+, and Pydantic v1 also
        rejects PEP 604 unions in some 3.9 / 3.10 deployments.
      * Explicit `typing.get_type_hints(...)` call when
        `from __future__ import annotations` is NOT present. Without future
        annotations, `get_type_hints` evaluates the annotation strings live,
        and the rewritten generics may not subscript on older interpreters.

    Returns:
        A short reason string when the file is unsafe, or None when it's fine.
    """
    # Pydantic v1 marker: imports `BaseModel` from `pydantic` (the package,
    # NOT `pydantic.v1`) and does NOT import anything that only exists in v2
    # (e.g. `ConfigDict`, `field_validator`, `model_validator`).
    has_pydantic_basemodel = False
    has_v2_marker = False
    V2_MARKERS = {"ConfigDict", "field_validator", "model_validator", "TypeAdapter"}

    has_get_type_hints = False
    # Local names that resolve to `typing.get_type_hints`. Always include the
    # canonical name; aliased forms (`from typing import get_type_hints as gth`)
    # add their bound local. Used to detect bare-call usage in the third pass.
    get_type_hints_locals: set[str] = {"get_type_hints"}

    for stmt in module.body:
        if not isinstance(stmt, cst.SimpleStatementLine):
            continue
        for small in stmt.body:
            if isinstance(small, cst.ImportFrom):
                mod = small.module
                if isinstance(mod, cst.Name) and mod.value == "pydantic":
                    if not isinstance(small.names, cst.ImportStar):
                        for alias in small.names:
                            if isinstance(alias.name, cst.Name):
                                if alias.name.value == "BaseModel":
                                    has_pydantic_basemodel = True
                                if alias.name.value in V2_MARKERS:
                                    has_v2_marker = True
                if isinstance(mod, cst.Name) and mod.value == "typing":
                    if not isinstance(small.names, cst.ImportStar):
                        for alias in small.names:
                            if (
                                isinstance(alias.name, cst.Name)
                                and alias.name.value == "get_type_hints"
                            ):
                                has_get_type_hints = True
                                # Aliased: `from typing import get_type_hints as gth`
                                if alias.asname is not None and isinstance(
                                    alias.asname.name, cst.Name
                                ):
                                    get_type_hints_locals.add(alias.asname.name.value)

    # TODO(v0.4): the bare `from pydantic import BaseModel` test is a
    # false-positive for Pydantic v2 users who don't import any of the V2
    # markers (e.g. they use `BaseModel` + plain `Field` only). Look for a
    # version pin in pyproject.toml / requirements.txt to disambiguate
    # instead of pattern-matching imports.
    if has_pydantic_basemodel and not has_v2_marker:
        return (
            "file imports pydantic.BaseModel (v1); pydantic v1 walks "
            "annotations at runtime and may reject the rewritten types"
        )

    if has_get_type_hints and not is_future_annotations(module):
        return (
            "file uses typing.get_type_hints without "
            "`from __future__ import annotations`; rewriting may break runtime "
            "annotation evaluation on Python 3.9 / 3.10"
        )

    # Third pass: bare `Name(...)` calls where the callee name is in our
    # alias set (e.g. `gth(SomeModel)` after `from typing import
    # get_type_hints as gth`). The `has_get_type_hints` branch above only
    # catches the canonical name in import lines; an aliased re-export with
    # no other markers would otherwise slip through.
    if (
        not is_future_annotations(module)
        and len(get_type_hints_locals) > 1  # at least one alias beyond the canonical
    ):
        for call in m.findall(module, m.Call()):
            func = call.func
            if isinstance(func, cst.Name) and func.value in get_type_hints_locals:
                return (
                    "file uses typing.get_type_hints (aliased) without "
                    "`from __future__ import annotations`; rewriting may break "
                    "runtime annotation evaluation on Python 3.9 / 3.10"
                )

    # Also detect bare `get_type_hints(...)` calls when imported as
    # `from typing import get_type_hints` was missed above (e.g. attribute
    # access `typing.get_type_hints(...)`).
    has_typing_alias = False
    typing_aliases: set[str] = set()
    for stmt in module.body:
        if not isinstance(stmt, cst.SimpleStatementLine):
            continue
        for small in stmt.body:
            if isinstance(small, cst.Import):
                for alias in small.names:
                    if isinstance(alias.name, cst.Name) and alias.name.value == "typing":
                        has_typing_alias = True
                        if alias.asname is not None and isinstance(alias.asname.name, cst.Name):
                            typing_aliases.add(alias.asname.name.value)
                        else:
                            typing_aliases.add("typing")
    if has_typing_alias and not is_future_annotations(module):
        for attr in m.findall(module, m.Attribute()):
            if (
                isinstance(attr.value, cst.Name)
                and attr.value.value in typing_aliases
                and attr.attr.value == "get_type_hints"
            ):
                return (
                    "file uses typing.get_type_hints without "
                    "`from __future__ import annotations`; rewriting may break "
                    "runtime annotation evaluation on Python 3.9 / 3.10"
                )

    return None


# ---------------------------------------------------------------------------
# Import cleanup


def _typing_names_still_used(module: cst.Module, candidate_names: set[str]) -> set[str]:
    """Return the subset of `candidate_names` that still appear as Name
    references in the (already-rewritten) module body, EXCLUDING references
    inside `from typing import ...` import lines (which are the names we're
    deciding whether to drop).
    """
    used: set[str] = set()

    class Visitor(cst.CSTVisitor):
        def __init__(self) -> None:
            super().__init__()
            self._in_typing_import = 0

        def visit_ImportFrom(self, node: cst.ImportFrom) -> bool:
            if isinstance(node.module, cst.Name) and node.module.value == "typing":
                self._in_typing_import += 1
            return True

        def leave_ImportFrom(self, original_node: cst.ImportFrom) -> None:
            if isinstance(original_node.module, cst.Name) and original_node.module.value == "typing":
                self._in_typing_import -= 1

        def visit_Name(self, node: cst.Name) -> None:
            if self._in_typing_import:
                return
            if node.value in candidate_names:
                used.add(node.value)

    module.visit(Visitor())
    return used


def _abc_import_already_has(module: cst.Module, name: str) -> bool:
    for stmt in module.body:
        if not isinstance(stmt, cst.SimpleStatementLine):
            continue
        for small in stmt.body:
            if not isinstance(small, cst.ImportFrom):
                continue
            mod = small.module
            mod_str = _module_dotted(mod)
            if mod_str != "collections.abc":
                continue
            if isinstance(small.names, cst.ImportStar):
                return True
            for alias in small.names:
                if isinstance(alias.name, cst.Name) and alias.name.value == name:
                    return True
    return False


def _re_import_already_has(module: cst.Module, name: str) -> bool:
    for stmt in module.body:
        if not isinstance(stmt, cst.SimpleStatementLine):
            continue
        for small in stmt.body:
            if not isinstance(small, cst.ImportFrom):
                continue
            mod = small.module
            mod_str = _module_dotted(mod)
            if mod_str != "re":
                continue
            if isinstance(small.names, cst.ImportStar):
                return True
            for alias in small.names:
                if isinstance(alias.name, cst.Name) and alias.name.value == name:
                    return True
    return False


def _module_dotted(node) -> str:
    if node is None:
        return ""
    if isinstance(node, cst.Name):
        return node.value
    if isinstance(node, cst.Attribute):
        return _module_dotted(node.value) + "." + node.attr.value
    return ""


class _TypingImportPruner(cst.CSTTransformer):
    """Remove the given names from `from typing import ...` lines, dropping
    the whole statement if no names remain after pruning. Leaves aliased forms
    (`from typing import List as L`) alone — the rewriter only touches bare
    names, so an aliased symbol may still be in use under its rename and we
    won't have rewritten its sites.
    """

    def __init__(self, removed: set[str]):
        self.removed = removed

    def leave_ImportFrom(
        self, original: cst.ImportFrom, updated: cst.ImportFrom
    ) -> cst.BaseSmallStatement | cst.RemovalSentinel:
        mod = updated.module
        if not (isinstance(mod, cst.Name) and mod.value == "typing"):
            return updated
        if isinstance(updated.names, cst.ImportStar):
            return updated
        kept: list[cst.ImportAlias] = []
        for alias in updated.names:
            # Genuine renames (`from typing import List as L`) must be kept
            # verbatim — the rewriter only touches the bare/no-op-aliased form
            # so an `as L` rename means there's still a live `L[...]` usage
            # we have not converted and therefore the import line must stay.
            if alias.asname is not None:
                bound = alias.asname.name
                canonical = (
                    alias.name.value if isinstance(alias.name, cst.Name) else None
                )
                if (
                    isinstance(bound, cst.Name)
                    and canonical is not None
                    and bound.value != canonical
                ):
                    kept.append(alias)
                    continue
            if isinstance(alias.name, cst.Name) and alias.name.value in self.removed:
                continue
            kept.append(alias)
        if not kept:
            return cst.RemoveFromParent()
        # Normalize trailing commas to avoid trailing-comma-with-no-following-name.
        kept = list(kept)
        last = kept[-1]
        kept[-1] = last.with_changes(comma=cst.MaybeSentinel.DEFAULT)
        return updated.with_changes(names=tuple(kept))


def _alias_local(alias: cst.ImportAlias) -> str | None:
    if alias.asname is None:
        return alias.name.value if isinstance(alias.name, cst.Name) else None
    bound = alias.asname.name
    return bound.value if isinstance(bound, cst.Name) else None


def _drop_empty_simple_stmt_lines(module: cst.Module) -> cst.Module:
    """After `_TypingImportPruner`, some `SimpleStatementLine`s may have lost
    all small statements (the ImportFrom was removed). LibCST's removal API
    returns RemovalSentinel for the small statement, which we paired with
    pruning logic above — but if we leave the SimpleStatementLine in place
    with an empty body, LibCST raises on .code. Filter those out here.
    """
    new_body: list = []
    for stmt in module.body:
        if isinstance(stmt, cst.SimpleStatementLine) and not stmt.body:
            continue
        new_body.append(stmt)
    return module.with_changes(body=tuple(new_body))


def _ensure_abc_import(module: cst.Module, names: set[str]) -> cst.Module:
    """Add `from collections.abc import <names>` (alphabetical) to the top of
    the module, merging with any existing `from collections.abc import ...`
    line. Names already imported are skipped.
    """
    to_add = sorted(n for n in names if not _abc_import_already_has(module, n))
    if not to_add:
        return module
    return _add_or_merge_from_import(module, "collections.abc", to_add)


def _ensure_re_import(module: cst.Module, names: set[str]) -> cst.Module:
    to_add = sorted(n for n in names if not _re_import_already_has(module, n))
    if not to_add:
        return module
    return _add_or_merge_from_import(module, "re", to_add)


def isinstance_uses_target(module: cst.Module, target_names: set[str]) -> bool:
    """True iff the module contains any ``isinstance(x, <T>[...])`` call where
    ``<T>`` is a `Name` whose value is in ``target_names``.

    Used by both PEP 585 and PEP 604 transforms when the
    ``from __future__ import annotations`` override is the only thing keeping
    the version gate from refusing. The future-annotations bypass is safe for
    annotation positions only — a runtime expression like
    ``isinstance(x, List[int])`` becomes ``isinstance(x, list[int])`` which
    ``TypeError``s on Python < 3.9. Same risk for PEP 604 unions on < 3.10.
    Conservative over-skip beats under-skip.
    """
    for call in m.findall(module, m.Call()):
        func = call.func
        if not (isinstance(func, cst.Name) and func.value == "isinstance"):
            continue
        args = call.args
        if len(args) < 2:
            continue
        second = args[1].value
        # Bare `Name`: `isinstance(x, List)` — skip (no subscript, no risk).
        if not isinstance(second, cst.Subscript):
            continue
        head = second.value
        if isinstance(head, cst.Name) and head.value in target_names:
            return True
        # Attribute form: `isinstance(x, typing.List[int])`.
        if (
            isinstance(head, cst.Attribute)
            and isinstance(head.attr, cst.Name)
            and head.attr.value in target_names
        ):
            return True
    return False


def _top_insertion_index(module: cst.Module) -> int:
    """Return the index in ``module.body`` where new top-of-file imports
    should land — i.e. after the module docstring, any
    ``from __future__ import ...`` lines, and any existing leading imports,
    but before the first non-import / non-docstring statement.

    Without skipping the docstring explicitly the loop breaks at index 0
    when it hits the docstring's ``Expr(SimpleString)`` body, producing an
    insertion at 0 — which silently destroys the module's ``__doc__``.
    """
    insertion_idx = 0
    for i, stmt in enumerate(module.body):
        if not isinstance(stmt, cst.SimpleStatementLine):
            break
        body0 = stmt.body[0] if stmt.body else None
        # Module docstring: a single Expr whose value is a SimpleString.
        if (
            body0 is not None
            and isinstance(body0, cst.Expr)
            and isinstance(body0.value, cst.SimpleString)
        ):
            insertion_idx = i + 1
            continue
        # `from __future__ import ...` must stay at the top.
        if (
            body0 is not None
            and isinstance(body0, cst.ImportFrom)
            and isinstance(body0.module, cst.Name)
            and body0.module.value == "__future__"
        ):
            insertion_idx = i + 1
            continue
        if all(isinstance(s, (cst.Import, cst.ImportFrom)) for s in stmt.body):
            insertion_idx = i + 1
            continue
        break
    return insertion_idx


def _add_or_merge_from_import(
    module: cst.Module, dotted_module: str, names: list[str]
) -> cst.Module:
    """Merge into an existing `from <dotted_module> import ...` if one exists,
    otherwise insert a fresh import line near the top of the module (after any
    existing imports / docstring / future imports).
    """
    # Try to find an existing import-from line to merge into.
    merged = False
    new_body: list = []
    for stmt in module.body:
        if merged or not isinstance(stmt, cst.SimpleStatementLine):
            new_body.append(stmt)
            continue
        replaced_small: list = []
        for small in stmt.body:
            if (
                isinstance(small, cst.ImportFrom)
                and _module_dotted(small.module) == dotted_module
                and not isinstance(small.names, cst.ImportStar)
            ):
                existing_names: list[cst.ImportAlias] = list(small.names)
                # Append new names that aren't already present.
                existing_set = {
                    a.name.value
                    for a in existing_names
                    if isinstance(a.name, cst.Name)
                }
                # Ensure trailing comma on the previous last entry.
                if existing_names:
                    last = existing_names[-1]
                    if last.comma is cst.MaybeSentinel.DEFAULT:
                        existing_names[-1] = last.with_changes(
                            comma=cst.Comma(whitespace_after=cst.SimpleWhitespace(" "))
                        )
                additions = [
                    cst.ImportAlias(name=cst.Name(n)) for n in names if n not in existing_set
                ]
                if additions:
                    # Strip trailing comma on the new last entry.
                    additions[-1] = additions[-1].with_changes(comma=cst.MaybeSentinel.DEFAULT)
                    existing_names.extend(additions)
                replaced_small.append(small.with_changes(names=tuple(existing_names)))
                merged = True
            else:
                replaced_small.append(small)
        new_body.append(stmt.with_changes(body=tuple(replaced_small)))

    if merged:
        return module.with_changes(body=tuple(new_body))

    # No existing import to merge into — insert a new one. Place it after any
    # leading docstring + `from __future__` imports + existing imports. Without
    # the docstring skip the insertion lands at index 0 and Python's module
    # docstring (`__doc__`) is destroyed.
    insertion_idx = _top_insertion_index(module)
    parts = _build_module_dotted(dotted_module)
    aliases = [cst.ImportAlias(name=cst.Name(n)) for n in names]
    # Strip trailing comma on the last entry.
    if aliases:
        aliases[-1] = aliases[-1].with_changes(comma=cst.MaybeSentinel.DEFAULT)
    new_import = cst.SimpleStatementLine(
        body=[cst.ImportFrom(module=parts, names=tuple(aliases))]
    )
    body = list(module.body)
    body.insert(insertion_idx, new_import)
    return module.with_changes(body=tuple(body))


def _build_module_dotted(dotted: str):
    parts = dotted.split(".")
    node: cst.BaseExpression = cst.Name(parts[0])
    for p in parts[1:]:
        node = cst.Attribute(value=node, attr=cst.Name(p))
    return node


def cleanup_typing_imports(
    module: cst.Module,
    removed_typing_names: set[str],
    add_collections_abc: set[str] | None = None,
    add_re_names: set[str] | None = None,
) -> cst.Module:
    """Drop the given names from `from typing import ...` once they're no
    longer referenced anywhere in the (already-rewritten) module, and
    optionally add `from collections.abc import ...` / `from re import ...`
    lines for replacement names. Returns a new module.

    `removed_typing_names` is the set of names the rewriter *would like to*
    drop. We only actually drop the ones that have no surviving Name reference
    outside the typing import line itself — a mixed-use file (some converted,
    some still used) keeps the import for the surviving names.

    When `add_collections_abc` / `add_re_names` are supplied, the Name
    references those new imports satisfy don't count towards "still used" —
    we're providing those names from a different import, so the typing import
    can be safely dropped.
    """
    # Build the set of typing names whose post-rewrite Name references resolve
    # to a fresh import we're about to add. For PEP 585 typing.Mapping has
    # been rewritten to bare `Mapping`, and we add `from collections.abc
    # import Mapping`; the surviving `Mapping` Name references resolve to that
    # new import, not the typing one.
    satisfied_by_new_import: set[str] = set()
    if add_collections_abc:
        satisfied_by_new_import |= set(add_collections_abc)
    if add_re_names:
        satisfied_by_new_import |= set(add_re_names)

    # The typing names we must double-check for surviving references. For
    # names that are being replaced by a same-name import elsewhere, the
    # check is moot (we'd drop either way).
    names_to_check = removed_typing_names - satisfied_by_new_import
    still_used = _typing_names_still_used(module, names_to_check)
    to_drop = removed_typing_names - still_used
    if to_drop:
        module = module.visit(_TypingImportPruner(to_drop))
        module = _drop_empty_simple_stmt_lines(module)
    if add_collections_abc:
        module = _ensure_abc_import(module, add_collections_abc)
    if add_re_names:
        module = _ensure_re_import(module, add_re_names)
    return module
