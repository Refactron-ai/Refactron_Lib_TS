"""PEP 585: rewrite ``typing.List[...]`` / ``List[...]`` (etc.) to the
lowercase builtin / ``collections.abc`` equivalents (Python >= 3.9).

Scope:
  * Conversion set (typing -> lowercase builtin):
        List, Dict, Tuple, Set, FrozenSet, Type, DefaultDict, OrderedDict,
        Counter, Deque, ChainMap.
  * typing -> ``collections.abc``:
        AbstractSet, MutableSet, Mapping, MutableMapping, Sequence,
        MutableSequence, Iterable, Iterator, Generator, AsyncIterable,
        AsyncIterator, Awaitable, Coroutine, Collection, Container, Hashable,
        Sized, Reversible, KeysView, ValuesView, ItemsView, MappingView,
        Callable.
  * typing -> ``re``:
        Pattern -> re.Pattern, Match -> re.Match.

Version gate:
  * Refuses with `python_version_too_low` when the project's resolved Python
    version is < 3.9, UNLESS the file starts with
    ``from __future__ import annotations`` (PEP 563 makes annotations strings
    at runtime, so the new generics are legal on any 3.7+ interpreter).

Runtime-eval precondition:
  * Refuses with `runtime_type_eval_unsafe` when the file is Pydantic v1
    (`from pydantic import BaseModel` with no v2 markers) OR uses
    `typing.get_type_hints` without `from __future__ import annotations`.
    Pydantic v1 evaluates annotations at runtime; new generics may fail
    `__class_getitem__` on Python 3.9-3.10.

NOT handled here:
  * `typing.Optional[...]` / `typing.Union[...]` — owned by the
    `pep604_optional_union` transform (we deliberately leave them alone).
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
    _top_insertion_index,
)

import libcst as cst  # noqa: E402


# typing-name -> ("builtin" | "abc" | "re", target-name)
BUILTIN_MAP = {
    "List": ("builtin", "list"),
    "Dict": ("builtin", "dict"),
    "Tuple": ("builtin", "tuple"),
    "Set": ("builtin", "set"),
    "FrozenSet": ("builtin", "frozenset"),
    "Type": ("builtin", "type"),
    "DefaultDict": ("collections", "defaultdict"),
    "OrderedDict": ("collections", "OrderedDict"),
    "Counter": ("collections", "Counter"),
    "Deque": ("collections", "deque"),
    "ChainMap": ("collections", "ChainMap"),
}

# typing-name -> collections.abc target-name (preserve casing).
ABC_MAP = {
    "AbstractSet": "Set",
    "MutableSet": "MutableSet",
    "Mapping": "Mapping",
    "MutableMapping": "MutableMapping",
    "Sequence": "Sequence",
    "MutableSequence": "MutableSequence",
    "Iterable": "Iterable",
    "Iterator": "Iterator",
    "Generator": "Generator",
    "AsyncIterable": "AsyncIterable",
    "AsyncIterator": "AsyncIterator",
    "Awaitable": "Awaitable",
    "Coroutine": "Coroutine",
    "Collection": "Collection",
    "Container": "Container",
    "Hashable": "Hashable",
    "Sized": "Sized",
    "Reversible": "Reversible",
    "KeysView": "KeysView",
    "ValuesView": "ValuesView",
    "ItemsView": "ItemsView",
    "MappingView": "MappingView",
    "Callable": "Callable",
}

RE_MAP = {
    "Pattern": "Pattern",
    "Match": "Match",
}

# All typing names we know how to rewrite.
ALL_TARGETS = set(BUILTIN_MAP.keys()) | set(ABC_MAP.keys()) | set(RE_MAP.keys())


def _collect_typing_aliases(module: cst.Module):
    """Return:
      - module_aliases: set of local names bound to the `typing` module
        (covers `import typing`, `import typing as t`).
      - bare_names: dict of local_name -> typing_canonical_name for entries
        imported via `from typing import X` (only the bare or no-op-aliased
        form binds the canonical name we can safely rewrite).
    """
    # TODO(v0.4): when only `import typing as t` is used (no `from typing
    # import ...`) and every `t.List[...]` site is rewritten, the
    # `import typing as t` line currently lingers as a dead import. Add a
    # cleanup pass that drops module-alias imports when no remaining
    # references survive.
    module_aliases: set[str] = set()
    bare_names: dict[str, str] = {}
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
                    # `from typing import *` — we can't track aliases reliably.
                    # Treat every canonical name as in-scope.
                    for canonical in ALL_TARGETS:
                        bare_names[canonical] = canonical
                    continue
                for alias in small.names:
                    if not isinstance(alias.name, cst.Name):
                        continue
                    canonical = alias.name.value
                    if canonical not in ALL_TARGETS:
                        continue
                    # Only the bare (or no-op `as <same>`) form binds the
                    # canonical local name. Genuine renames are out of scope —
                    # we don't know what target they map to without resolving
                    # `as` semantics, and rewriting the alias name might
                    # collide.
                    if alias.asname is None:
                        bare_names[canonical] = canonical
                    else:
                        bound = alias.asname.name
                        if isinstance(bound, cst.Name) and bound.value == canonical:
                            bare_names[canonical] = canonical
    return module_aliases, bare_names


def _rewrite_target(canonical: str):
    """Return the cst node that should replace the subscript's `value`
    (e.g. `cst.Name("list")` for List, `cst.Attribute(...)` for re.Pattern).
    Also returns a (need_abc, need_re, need_collections) tuple of import
    requirements as ("abc"|"re"|"collections", target_name) when applicable.
    """
    if canonical in BUILTIN_MAP:
        kind, target = BUILTIN_MAP[canonical]
        if kind == "builtin":
            return cst.Name(target), None
        # collections.<x> — emit attribute form rather than adding a new import.
        return (
            cst.Attribute(value=cst.Name("collections"), attr=cst.Name(target)),
            ("collections-module", target),
        )
    if canonical in ABC_MAP:
        return cst.Name(ABC_MAP[canonical]), ("abc", ABC_MAP[canonical])
    if canonical in RE_MAP:
        return cst.Name(RE_MAP[canonical]), ("re", RE_MAP[canonical])
    return None, None


class _SubscriptRewriter(cst.CSTTransformer):
    def __init__(self, module_aliases: set[str], bare_names: dict[str, str]):
        self.module_aliases = module_aliases
        self.bare_names = bare_names
        self.changed = False
        # Track what we rewrote so the cleanup pass knows which typing names
        # to consider for removal and which abc / re names to add.
        self.rewrote_typing_names: set[str] = set()
        self.need_abc: set[str] = set()
        self.need_re: set[str] = set()
        # Whether we used the bare `collections` module name (so we should
        # ensure `import collections` is present).
        self.need_collections_module = False

    def _classify(self, value: cst.BaseExpression):
        """Return (canonical_name, was_bare) if `value` refers to one of our
        target typing names — either via `from typing import X` or
        `typing.X` / `t.X` — else (None, _).
        """
        if isinstance(value, cst.Name):
            if value.value in self.bare_names:
                return self.bare_names[value.value], True
            return None, False
        if isinstance(value, cst.Attribute):
            base = value.value
            if isinstance(base, cst.Name) and base.value in self.module_aliases:
                if value.attr.value in ALL_TARGETS:
                    return value.attr.value, False
        return None, False

    def leave_Subscript(
        self, original: cst.Subscript, updated: cst.Subscript
    ) -> cst.BaseExpression:
        canonical, was_bare = self._classify(updated.value)
        if canonical is None:
            return updated
        new_value, import_req = _rewrite_target(canonical)
        if new_value is None:
            return updated
        self.changed = True
        if was_bare:
            self.rewrote_typing_names.add(canonical)
        if import_req is not None:
            kind, target = import_req
            if kind == "abc":
                self.need_abc.add(target)
            elif kind == "re":
                self.need_re.add(target)
            elif kind == "collections-module":
                self.need_collections_module = True
        return updated.with_changes(value=new_value)


def _ensure_collections_module_import(module: cst.Module) -> cst.Module:
    """Add `import collections` if missing. We use attribute form
    `collections.defaultdict` etc. for the collections-module replacements
    (defaultdict, OrderedDict, Counter, deque, ChainMap) to avoid stomping on
    user-chosen import styles."""
    # TODO(v0.4): when the file already has `import collections as c`, we
    # currently still emit `collections.defaultdict` (broken) and add a fresh
    # `import collections` next to it (duplicate). Either rewrite to `c.X`
    # using the existing alias, or refuse the file with a precondition.
    for stmt in module.body:
        if not isinstance(stmt, cst.SimpleStatementLine):
            continue
        for small in stmt.body:
            if isinstance(small, cst.Import):
                for alias in small.names:
                    if isinstance(alias.name, cst.Name) and alias.name.value == "collections":
                        # asname is fine — we used the attribute form
                        # `collections.X`; if user wrote `import collections as c`
                        # we still emit `collections.X` which is broken. So we
                        # only accept the bare form.
                        if alias.asname is None:
                            return module
            if isinstance(small, cst.ImportFrom):
                mod = small.module
                if isinstance(mod, cst.Name) and mod.value == "collections":
                    # User imported names from collections directly — that
                    # doesn't bind `collections` as a module name. Continue.
                    pass
    # Need to add `import collections`. Insert near the top, after any leading
    # docstring + `__future__` imports + existing imports. The shared helper
    # skips the module docstring so we don't clobber `__doc__`.
    insertion_idx = _top_insertion_index(module)
    new_stmt = cst.SimpleStatementLine(
        body=[cst.Import(names=[cst.ImportAlias(name=cst.Name("collections"))])]
    )
    body = list(module.body)
    body.insert(insertion_idx, new_stmt)
    return module.with_changes(body=tuple(body))


def main():
    if len(sys.argv) < 2:
        emit(ok=False, error="usage: pep585_generics.py <file> [cross_file_json]")
        return
    path_ = sys.argv[1]
    cross_file = load_cross_file(2)
    src = read_source(path_)

    try:
        module = cst.parse_module(src)
    except cst.ParserSyntaxError as e:
        emit(ok=False, error=f"parse error: {e}")
        return

    # `from __future__ import annotations` overrides the runtime version gate.
    future_ann = is_future_annotations(module)
    version_ok = at_least(cross_file, 3, 9)

    # If we're only proceeding because of the __future__ override (i.e. the
    # runtime version is < 3.9), refuse files that subscript any of our target
    # typing names in a runtime expression like `isinstance(x, List[int])` —
    # that becomes `isinstance(x, list[int])` and `TypeError`s on 3.8.
    if future_ann and not version_ok and isinstance_uses_target(module, ALL_TARGETS):
        emit(
            ok=True,
            new_content="",
            preconditions=[
                {
                    "id": "runtime_subscript_unsafe",
                    "satisfied": False,
                    "reason": (
                        "file uses `isinstance(..., <T>[...])` with a typing "
                        "generic that pep585 would rewrite; the rewritten form "
                        "is not runtime-subscriptable on Python < 3.9 (the "
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
                        "pep585_generics requires Python >= 3.9 (or "
                        "`from __future__ import annotations`); project's "
                        "minimum version is unset or older."
                    ),
                }
            ],
        )
        return

    # Runtime-eval safety precondition (Pydantic v1 / get_type_hints).
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

    rewriter = _SubscriptRewriter(module_aliases, bare_names)
    new_module = module.visit(rewriter)
    if not rewriter.changed:
        emit(ok=True, new_content="", preconditions=[])
        return

    # Ensure `import collections` if needed (for the attribute-form
    # replacements like `collections.defaultdict`).
    if rewriter.need_collections_module:
        new_module = _ensure_collections_module_import(new_module)

    # Cleanup: drop now-unused typing names; add abc / re imports as needed.
    new_module = cleanup_typing_imports(
        new_module,
        removed_typing_names=rewriter.rewrote_typing_names,
        add_collections_abc=rewriter.need_abc,
        add_re_names=rewriter.need_re,
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
