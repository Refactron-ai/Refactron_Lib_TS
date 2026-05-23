"""@functools.lru_cache(maxsize=None) -> @functools.cache (Python >= 3.9).

Conservative scope for v0.3.0:
- Only rewrite the `maxsize=None` form. `@lru_cache()`, `@lru_cache(128)`,
  `@lru_cache(maxsize=1024)`, and the typed=True variant are left untouched
  -- they all carry semantics that `functools.cache` does NOT preserve.
- Version gate: refuse with `python_version_too_low` when the project's
  resolved Python version is < 3.9 (or unknown). `functools.cache` is a
  3.9+ addition.
- Imports: when only the `from functools import lru_cache` form was used and
  every site is converted, we rewrite that import to
  `from functools import cache`. When some sites remain (e.g. another
  `@lru_cache(128)` use), we keep `lru_cache` and ADD `cache` to the same
  ImportFrom -- minimum diff, no module-level surprises.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _base import read_source, emit  # noqa: E402
from _cross_file import load_cross_file  # noqa: E402
from _python_version import at_least  # noqa: E402

import libcst as cst  # noqa: E402


def _is_target_decorator(call: cst.Call, aliases: dict) -> bool:
    """True iff `call` is `lru_cache(maxsize=None)` or
    `functools.lru_cache(maxsize=None)` (using a recognised alias).
    """
    fn = call.func
    is_lru = False
    if isinstance(fn, cst.Name):
        if fn.value == "lru_cache" and "lru_cache" in aliases:
            is_lru = True
    elif isinstance(fn, cst.Attribute):
        if (
            isinstance(fn.value, cst.Name)
            and fn.value.value in aliases.get("__module_aliases__", set())
            and fn.attr.value == "lru_cache"
        ):
            is_lru = True
    if not is_lru:
        return False
    # Must have exactly the maxsize=None keyword (no typed= etc.).
    # Notes on the forms we INTENTIONALLY skip here:
    #   - `@lru_cache()` (zero args) is semantically equivalent to
    #     `@lru_cache(maxsize=128)` per CPython docs (the default cap is
    #     128, NOT unbounded), so it is NOT a safe `@cache` substitute.
    #     The analyzer's `lru-cache-maxsize-none` detector is strict and
    #     only flags `maxsize=None`, so we shouldn't normally see this
    #     form arrive here — but if a user invokes the transform directly
    #     we still skip cleanly via the `len(call.args) != 1` guard.
    #   - `@lru_cache(128)` / `@lru_cache(maxsize=1024)` set a finite cap.
    #   - `@lru_cache(maxsize=None, typed=True)` adds type discrimination.
    if len(call.args) != 1:
        return False
    arg = call.args[0]
    if arg.keyword is None or arg.keyword.value != "maxsize":
        return False
    if not isinstance(arg.value, cst.Name) or arg.value.value != "None":
        return False
    return True


def collect_aliases(module: cst.Module) -> dict:
    """Discover the local names bound to `functools` / `functools.lru_cache`.

    Returns a dict with keys:
      - `__module_aliases__`: set of local names that refer to `functools`
        as a module (covers `import functools`, `import functools as F`).
      - `lru_cache`: True iff `from functools import lru_cache` was seen
        WITHOUT a rebinding asname (or with the no-op `as lru_cache`).
        A bare-name `@lru_cache` decorator only resolves to functools'
        symbol when this is true.
      - `lru_cache_aliases`: set of local names that the user bound
        `functools.lru_cache` to via `from functools import lru_cache as X`
        (X != "lru_cache"). These are NOT treated as the bare name; if the
        user wrote `@X(maxsize=None)` we would have to know X to rewrite it,
        and we currently don't. They're tracked here only so the import
        rewriter can leave such aliased import lines alone.
    """
    module_aliases: set[str] = set()
    has_bare_lru = False
    lru_aliases: set[str] = set()

    for stmt in module.body:
        if not isinstance(stmt, cst.SimpleStatementLine):
            continue
        for small in stmt.body:
            if isinstance(small, cst.Import):
                for alias in small.names:
                    if isinstance(alias.name, cst.Name) and alias.name.value == "functools":
                        local = (
                            alias.asname.name.value
                            if alias.asname is not None and isinstance(alias.asname.name, cst.Name)
                            else "functools"
                        )
                        module_aliases.add(local)
            elif isinstance(small, cst.ImportFrom):
                if (
                    small.module is not None
                    and isinstance(small.module, cst.Name)
                    and small.module.value == "functools"
                    and not isinstance(small.names, cst.ImportStar)
                ):
                    for alias in small.names:
                        if isinstance(alias.name, cst.Name) and alias.name.value == "lru_cache":
                            # Only the bare form (or the no-op `as lru_cache`)
                            # binds the local name `lru_cache`. An asname
                            # like `as cache_dec` rebinds the symbol; we do
                            # NOT touch decorators using the asname, so we
                            # must NOT claim the bare name is in scope.
                            if alias.asname is None:
                                has_bare_lru = True
                            else:
                                bound = alias.asname.name
                                if isinstance(bound, cst.Name) and bound.value == "lru_cache":
                                    has_bare_lru = True
                                elif isinstance(bound, cst.Name):
                                    lru_aliases.add(bound.value)
    out: dict = {"__module_aliases__": module_aliases, "lru_cache_aliases": lru_aliases}
    if has_bare_lru:
        out["lru_cache"] = True
    return out


class DecoratorRewriter(cst.CSTTransformer):
    def __init__(self, aliases: dict):
        self.aliases = aliases
        self.changed = False
        # Track which "kinds" of lru_cache reference we rewrote. If we
        # rewrote a bare-name `@lru_cache(maxsize=None)`, the `lru_cache`
        # import may now be unused; we hand that decision to the import
        # cleanup pass.
        self.removed_bare_lru = False
        # Track whether any `lru_cache` references survive (e.g. another
        # `@lru_cache(128)` decorator). If so, we keep the original import
        # and just augment it with `cache`.
        self.bare_lru_survivors = 0
        # Likewise for the attribute form.
        self.functools_attr_survivors = 0

    def leave_Decorator(
        self, original: cst.Decorator, updated: cst.Decorator
    ) -> cst.Decorator:
        deco = updated.decorator
        if not isinstance(deco, cst.Call):
            return updated
        if not _is_target_decorator(deco, self.aliases):
            return updated
        fn = deco.func
        new_func: cst.BaseExpression
        if isinstance(fn, cst.Name):
            new_func = cst.Name("cache")
            self.removed_bare_lru = True
        else:
            assert isinstance(fn, cst.Attribute)
            new_func = fn.with_changes(attr=cst.Name("cache"))
        self.changed = True
        # `@functools.cache` / `@cache` take no args.
        return updated.with_changes(decorator=new_func)


def _count_lru_references(module: cst.Module, aliases: dict) -> tuple[int, int]:
    """Count surviving `lru_cache` references AFTER decorator rewriting.

    Returns (bare_count, attr_count). Used to decide whether the
    `from functools import lru_cache` import can be replaced by `cache`
    or must be augmented with `cache` instead.

    Implementation note: the visitor counts every `lru_cache` Name in the
    tree, which INCLUDES the names that appear inside
    `from functools import lru_cache` statements themselves. We subtract one
    per such import statement to recover the count of true use-sites.
    Counting statements rather than assuming exactly one keeps the math
    correct even in the (legal but rare) case of multiple
    `from functools import lru_cache` lines in the same module.
    """
    module_aliases = aliases.get("__module_aliases__", set())
    bare = 0
    attr = 0
    bare_import_occurrences = 0

    # Count how many `from functools import ... lru_cache ...` import sites
    # exist — each contributes one Name("lru_cache") to the bare counter.
    if aliases.get("lru_cache"):
        for stmt in module.body:
            if not isinstance(stmt, cst.SimpleStatementLine):
                continue
            for small in stmt.body:
                if not isinstance(small, cst.ImportFrom):
                    continue
                if (
                    small.module is None
                    or not isinstance(small.module, cst.Name)
                    or small.module.value != "functools"
                    or isinstance(small.names, cst.ImportStar)
                ):
                    continue
                for alias in small.names:
                    if isinstance(alias.name, cst.Name) and alias.name.value == "lru_cache":
                        # Only the bare (or no-op-aliased) form binds the
                        # local name `lru_cache`; that's the only case where
                        # `collect_aliases` set `lru_cache=True`.
                        if alias.asname is None or (
                            isinstance(alias.asname.name, cst.Name)
                            and alias.asname.name.value == "lru_cache"
                        ):
                            bare_import_occurrences += 1

    class Counter(cst.CSTVisitor):
        def visit_Name(self, node: cst.Name) -> None:
            nonlocal bare
            if node.value == "lru_cache" and aliases.get("lru_cache"):
                bare += 1

        def visit_Attribute(self, node: cst.Attribute) -> None:
            nonlocal attr
            if (
                isinstance(node.value, cst.Name)
                and node.value.value in module_aliases
                and node.attr.value == "lru_cache"
            ):
                attr += 1

    module.visit(Counter())
    # Back out the import-statement self-references so `bare` reflects only
    # genuine use-sites that survived the decorator rewrite.
    bare -= bare_import_occurrences
    return bare, attr


class ImportRewriter(cst.CSTTransformer):
    """Update `from functools import ...` after decorator rewriting.

    - If `lru_cache` is no longer referenced AND we rewrote at least one bare
      site, replace the imported name `lru_cache` -> `cache`.
    - If `lru_cache` IS still referenced (e.g. another `@lru_cache(128)`) AND
      we rewrote a bare site, append `cache` next to `lru_cache`.
    - Otherwise (no bare site was rewritten — only `functools.lru_cache` was
      touched), leave the import alone.
    """

    def __init__(self, bare_unused: bool, bare_was_rewritten: bool):
        self.bare_unused = bare_unused
        self.bare_was_rewritten = bare_was_rewritten

    def leave_ImportFrom(
        self, original: cst.ImportFrom, updated: cst.ImportFrom
    ) -> cst.ImportFrom:
        if (
            updated.module is None
            or not isinstance(updated.module, cst.Name)
            or updated.module.value != "functools"
            or isinstance(updated.names, cst.ImportStar)
            or not self.bare_was_rewritten
        ):
            return updated

        names = list(updated.names)
        # Find lru_cache slot (if any).
        for i, alias in enumerate(names):
            if isinstance(alias.name, cst.Name) and alias.name.value == "lru_cache":
                # SAFETY: skip aliased forms entirely
                # (`from functools import lru_cache as cache_dec`).
                # The decorator rewriter only touches bare `@lru_cache(...)`
                # call sites — it never rewrites uses of the asname. If we
                # renamed the import here we'd end up with either a NameError
                # (asname rebound to `cache` while a surviving bare `@cache`
                # decorator expects the bare name) or a confusing rename of
                # a user-chosen alias. Leaving aliased imports alone is the
                # only consistent choice.
                if alias.asname is not None:
                    bound = alias.asname.name
                    if not (isinstance(bound, cst.Name) and bound.value == "lru_cache"):
                        # Genuine rebinding — leave untouched.
                        continue
                if self.bare_unused:
                    # Replace lru_cache -> cache. Strip any (no-op) asname so
                    # we don't emit `from functools import cache as cache`.
                    names[i] = alias.with_changes(name=cst.Name("cache"), asname=None)
                else:
                    # Insert `cache` alongside lru_cache (after it). Skip if
                    # `cache` already imported.
                    has_cache = any(
                        isinstance(a.name, cst.Name) and a.name.value == "cache"
                        for a in names
                    )
                    if not has_cache:
                        # Ensure the previous alias has a trailing comma.
                        if alias.comma is cst.MaybeSentinel.DEFAULT:
                            names[i] = alias.with_changes(
                                comma=cst.Comma(whitespace_after=cst.SimpleWhitespace(" "))
                            )
                        names.insert(i + 1, cst.ImportAlias(name=cst.Name("cache")))
                return updated.with_changes(names=tuple(names))
        return updated


def main():
    if len(sys.argv) < 2:
        emit(ok=False, error="usage: lru_cache_to_cache.py <file> [cross_file_json]")
        return
    path_ = sys.argv[1]
    cross_file = load_cross_file(2)
    src = read_source(path_)

    # Version gate -- refuse rather than guess. functools.cache requires 3.9+.
    if not at_least(cross_file, 3, 9):
        emit(
            ok=True,
            new_content="",
            preconditions=[
                {
                    "id": "python_version_too_low",
                    "satisfied": False,
                    "reason": (
                        "lru_cache_to_cache requires Python >= 3.9 "
                        "(functools.cache is a 3.9 addition); project's "
                        "minimum version is unset or older."
                    ),
                }
            ],
        )
        return

    try:
        module = cst.parse_module(src)
    except cst.ParserSyntaxError as e:
        emit(ok=False, error=f"parse error: {e}")
        return

    aliases = collect_aliases(module)
    rewriter = DecoratorRewriter(aliases)
    new_module = module.visit(rewriter)
    if not rewriter.changed:
        emit(ok=True, new_content="", preconditions=[])
        return

    # Decide if `lru_cache` is unused after rewriting (so we can rename the
    # import) or still used (so we must keep it and add `cache`).
    bare_remaining, _ = _count_lru_references(new_module, aliases)
    bare_was_rewritten = rewriter.removed_bare_lru
    import_pass = ImportRewriter(
        bare_unused=(bare_remaining == 0),
        bare_was_rewritten=bare_was_rewritten,
    )
    new_module = new_module.visit(import_pass)

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
