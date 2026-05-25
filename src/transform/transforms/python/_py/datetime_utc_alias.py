"""`datetime.timezone.utc` -> `datetime.UTC` (Python >= 3.11).

Scope (conservative for v0.3.0):
- Rewrites:
    * `datetime.timezone.utc`           -> `datetime.UTC`
    * `<dt-alias>.timezone.utc`         -> `<dt-alias>.UTC`
      (after `import datetime as <dt-alias>`)
    * `timezone.utc`                    -> `UTC`
      (after `from datetime import timezone`), AND merges `UTC` into the
      existing `from datetime import ...` line. If `timezone` has no other
      references, it is dropped from the import; otherwise it stays alongside
      `UTC`.
- Version gate: refuses with `python_version_too_low` when the project's
  resolved Python version is < 3.11 (or unknown). Unlike PEP 585 / 604, the
  `from __future__ import annotations` override does NOT apply -- `UTC` is a
  runtime attribute, not an annotation form.
- Refuses `from datetime import timezone as <X>` (X != "timezone") with the
  precondition `aliased_import_unsupported`. Rewriting `<X>.utc` correctly
  requires emitting a sibling `import` for the new `UTC` symbol under a
  different alias which is too much surface area for the v0.3.0 scope; v0.4
  follow-up tracked separately.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _base import read_source, emit  # noqa: E402
from _cross_file import load_cross_file  # noqa: E402
from _python_version import at_least  # noqa: E402

import libcst as cst  # noqa: E402


# TODO(v0.4 / OQ2): handle function-local `import datetime` (currently the
# top-level-only scan in this collector and the matching detector skip them,
# which is conservative but means a use-site like `def f(): import datetime;
# return datetime.timezone.utc` is never rewritten).
# TODO(v0.4 / OQ3): handle comma-separated module imports such as
# `import os, datetime` (this collector currently only walks each
# `cst.Import.names` so it should already work; verify with a regression test
# in v0.4 and remove this TODO once covered).
def _collect_aliases(module: cst.Module):
    """Return:
      - dt_module_aliases: set of local names bound to the `datetime` module
        (covers `import datetime` -> {"datetime"}, `import datetime as dt`
        -> {"dt"}).
      - bare_timezone: True iff `from datetime import timezone` (or the no-op
        `as timezone` form) was seen.
      - aliased_timezone: set of local names from
        `from datetime import timezone as <X>` where X != "timezone". When
        non-empty, we refuse the file (out of scope).
      - has_utc_already: True iff `from datetime import UTC` is already in the
        module (so we don't append it again).
      - datetime_importfrom_indices: list of (module-body-index,
        SimpleStatementLine-index, ImportFrom) for each
        `from datetime import ...` line, so the import rewriter can find them.
    """
    dt_module_aliases: set[str] = set()
    bare_timezone = False
    aliased_timezone: set[str] = set()
    has_utc_already = False
    datetime_importfroms: list = []

    for i, stmt in enumerate(module.body):
        if not isinstance(stmt, cst.SimpleStatementLine):
            continue
        for j, small in enumerate(stmt.body):
            if isinstance(small, cst.Import):
                for alias in small.names:
                    if isinstance(alias.name, cst.Name) and alias.name.value == "datetime":
                        if alias.asname is not None and isinstance(alias.asname.name, cst.Name):
                            dt_module_aliases.add(alias.asname.name.value)
                        else:
                            dt_module_aliases.add("datetime")
            elif isinstance(small, cst.ImportFrom):
                mod = small.module
                if not (isinstance(mod, cst.Name) and mod.value == "datetime"):
                    continue
                if isinstance(small.names, cst.ImportStar):
                    # `from datetime import *` brings in `timezone` AND `UTC`
                    # (on 3.11+) under their canonical names; the runtime
                    # name resolution works, but the import-cleanup math
                    # becomes ambiguous. Skip the cleanup pass entirely by
                    # not registering this line.
                    continue
                datetime_importfroms.append((i, j, small))
                for alias in small.names:
                    if not isinstance(alias.name, cst.Name):
                        continue
                    canonical = alias.name.value
                    if canonical == "timezone":
                        if alias.asname is None:
                            bare_timezone = True
                        else:
                            bound = alias.asname.name
                            if isinstance(bound, cst.Name) and bound.value == "timezone":
                                bare_timezone = True
                            elif isinstance(bound, cst.Name):
                                aliased_timezone.add(bound.value)
                    elif canonical == "UTC":
                        # Bare or no-op-aliased only — a genuine rename
                        # (`UTC as U`) wouldn't shadow `UTC` so this can stay
                        # additive.
                        if alias.asname is None:
                            has_utc_already = True
                        else:
                            bound = alias.asname.name
                            if isinstance(bound, cst.Name) and bound.value == "UTC":
                                has_utc_already = True

    return (
        dt_module_aliases,
        bare_timezone,
        aliased_timezone,
        has_utc_already,
        datetime_importfroms,
    )


class _UtcRewriter(cst.CSTTransformer):
    """Rewrite `<dt-alias>.timezone.utc` -> `<dt-alias>.UTC` and
    `timezone.utc` -> `UTC` (only when `timezone` is in scope via the bare
    `from datetime import timezone` form)."""

    def __init__(self, dt_module_aliases: set[str], bare_timezone: bool):
        self.dt_module_aliases = dt_module_aliases
        self.bare_timezone = bare_timezone
        self.changed = False
        # Tracks whether we rewrote any `timezone.utc` use-site. The import
        # cleanup pass uses this to decide whether to add `UTC` to the
        # `from datetime import ...` line.
        self.rewrote_bare_timezone_utc = False

    def leave_Attribute(
        self, original: cst.Attribute, updated: cst.Attribute
    ) -> cst.BaseExpression:
        if updated.attr.value != "utc":
            return updated
        inner = updated.value
        # Case A: <dt-alias>.timezone.utc -> <dt-alias>.UTC
        if isinstance(inner, cst.Attribute):
            inner_obj = inner.value
            inner_attr = inner.attr
            if (
                isinstance(inner_obj, cst.Name)
                and inner_obj.value in self.dt_module_aliases
                and isinstance(inner_attr, cst.Name)
                and inner_attr.value == "timezone"
            ):
                self.changed = True
                return cst.Attribute(value=inner_obj, attr=cst.Name("UTC"))
        # Case B: timezone.utc -> UTC (only when bare `timezone` is imported
        # from datetime; a locally-defined `timezone` would slip past us, but
        # the detector also requires the import, so we mirror that gate here).
        if (
            isinstance(inner, cst.Name)
            and inner.value == "timezone"
            and self.bare_timezone
        ):
            self.changed = True
            self.rewrote_bare_timezone_utc = True
            return cst.Name("UTC")
        return updated


def _count_bare_timezone_references(module: cst.Module) -> int:
    """Count occurrences of bare `Name("timezone")` outside of import
    statements. Used after the rewrite pass to decide whether `timezone` can
    be dropped from the `from datetime import ...` line. We exclude import
    statements because every `from datetime import timezone` contributes one
    `Name("timezone")` that is not a true use-site."""
    count = 0

    class V(cst.CSTVisitor):
        def __init__(self):
            self.in_import = 0

        def visit_Import(self, node: cst.Import) -> None:
            self.in_import += 1

        def leave_Import(self, original: cst.Import) -> None:
            self.in_import -= 1

        def visit_ImportFrom(self, node: cst.ImportFrom) -> None:
            self.in_import += 1

        def leave_ImportFrom(self, original: cst.ImportFrom) -> None:
            self.in_import -= 1

        def visit_Name(self, node: cst.Name) -> None:
            nonlocal count
            if node.value == "timezone" and self.in_import == 0:
                count += 1

    module.visit(V())
    return count


class _ImportFromRewriter(cst.CSTTransformer):
    """Update each `from datetime import ...` line:

    - If we rewrote at least one `timezone.utc` site AND `UTC` is not already
      imported, add `UTC` to the import names (kept alphabetically reasonable
      by inserting BEFORE `timezone` so `from datetime import UTC, timezone`
      reads naturally; if `timezone` is being dropped, `UTC` simply replaces
      it in place).
    - If `timezone` has zero surviving non-import references, drop it from
      the import names. If it was the only name, drop the entire ImportFrom.
    """

    def __init__(
        self,
        drop_timezone: bool,
        add_utc: bool,
    ):
        self.drop_timezone = drop_timezone
        self.add_utc = add_utc
        self.utc_added_once = False

    def leave_ImportFrom(
        self,
        original: cst.ImportFrom,
        updated: cst.ImportFrom,
    ):
        mod = updated.module
        if not (isinstance(mod, cst.Name) and mod.value == "datetime"):
            return updated
        if isinstance(updated.names, cst.ImportStar):
            return updated

        names = list(updated.names)

        # Find the timezone slot.
        tz_idx: int | None = None
        has_utc_local = False
        for i, alias in enumerate(names):
            if isinstance(alias.name, cst.Name):
                if alias.name.value == "timezone":
                    # Only the bare-or-no-op-aliased form is in play; a true
                    # rename was already detected as aliased_timezone and
                    # caused the transform to refuse before we ever get here.
                    if alias.asname is None or (
                        isinstance(alias.asname.name, cst.Name)
                        and alias.asname.name.value == "timezone"
                    ):
                        tz_idx = i
                elif alias.name.value == "UTC":
                    has_utc_local = True

        if self.add_utc and not has_utc_local and not self.utc_added_once:
            # Insert UTC. Prefer the timezone slot (replace if dropping, else
            # adjacent to it). If neither timezone is present nor we're
            # adding here (some other `from datetime import ...` line),
            # we still add UTC to keep the merge in a single line.
            if tz_idx is not None and self.drop_timezone:
                # Replace timezone with UTC, preserving the alias's comma/etc.
                tz_alias = names[tz_idx]
                names[tz_idx] = tz_alias.with_changes(
                    name=cst.Name("UTC"), asname=None
                )
                # Mark "consumed" so the drop pass below doesn't try to
                # delete the slot we just rewrote.
                tz_idx = None
                self.utc_added_once = True
            elif tz_idx is not None:
                # Insert UTC BEFORE the timezone slot. Make sure the inserted
                # alias carries a trailing comma so the rendered line stays
                # parseable. For multi-line parenthesized imports we want the
                # new comma's `whitespace_after` to MATCH the existing style
                # (typically `ParenthesizedWhitespace` for one-name-per-line
                # forms), otherwise we end up emitting `UTC, timezone,` on a
                # single line inside an otherwise vertical block. Inherit it
                # from the alias immediately PRECEDING `timezone` (i.e. the
                # alias at tz_idx - 1) if one exists; that alias's own
                # `comma.whitespace_after` is exactly the inter-alias spacing
                # the file uses.
                inherited_ws = cst.SimpleWhitespace(" ")
                if tz_idx > 0:
                    prev = names[tz_idx - 1]
                    if isinstance(prev.comma, cst.Comma):
                        inherited_ws = prev.comma.whitespace_after
                utc_alias = cst.ImportAlias(
                    name=cst.Name("UTC"),
                    comma=cst.Comma(whitespace_after=inherited_ws),
                )
                names.insert(tz_idx, utc_alias)
                # tz_idx shifts by +1 because of the insertion above.
                tz_idx = tz_idx + 1
                self.utc_added_once = True
            else:
                # No timezone slot on this line — append UTC at the end. We
                # ensure the previous last alias carries a trailing comma.
                if names:
                    last = names[-1]
                    if last.comma is cst.MaybeSentinel.DEFAULT:
                        names[-1] = last.with_changes(
                            comma=cst.Comma(whitespace_after=cst.SimpleWhitespace(" "))
                        )
                    names.append(cst.ImportAlias(name=cst.Name("UTC")))
                    self.utc_added_once = True

        # Drop timezone if it's now unused.
        if self.drop_timezone and tz_idx is not None:
            del names[tz_idx]

        if not names:
            # No remaining imports on this line — remove it entirely by
            # returning a sentinel the parent SimpleStatementLine can drop.
            # libcst doesn't have a clean ImportFrom drop, so we replace it
            # with an ImportFrom that imports `UTC` only as a fallback (which
            # shouldn't happen given add_utc above already kept names
            # non-empty). To be safe, leave the import alone here and let
            # the caller decide.
            return updated

        # If the LAST alias has a dangling comma (because we replaced/dropped
        # the trailing one), strip its comma to keep the rendered line clean
        # -- BUT only for the single-line form. Parenthesized multi-line
        # imports (`from datetime import (\n    UTC,\n    timedelta,\n)`)
        # idiomatically carry a trailing comma; `black`/`ruff format` will
        # re-add it on the next run, so stripping it here just churns the
        # diff. `lpar` is an empty tuple (NOT MaybeSentinel) when the import
        # is not parenthesized.
        is_parenthesized = bool(updated.lpar)
        if names and not is_parenthesized:
            last = names[-1]
            if last.comma is not cst.MaybeSentinel.DEFAULT:
                names[-1] = last.with_changes(comma=cst.MaybeSentinel.DEFAULT)

        return updated.with_changes(names=tuple(names))


def main():
    if len(sys.argv) < 2:
        emit(ok=False, error="usage: datetime_utc_alias.py <file> [cross_file_json]")
        return
    path_ = sys.argv[1]
    cross_file = load_cross_file(2)
    src = read_source(path_)

    # Version gate -- refuse rather than guess. `datetime.UTC` requires 3.11+.
    if not at_least(cross_file, 3, 11):
        emit(
            ok=True,
            new_content="",
            preconditions=[
                {
                    "id": "python_version_too_low",
                    "satisfied": False,
                    "reason": (
                        "datetime_utc_alias requires Python >= 3.11 "
                        "(`datetime.UTC` is a 3.11 addition); project's "
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

    (
        dt_module_aliases,
        bare_timezone,
        aliased_timezone,
        _has_utc_already,
        _datetime_importfroms,
    ) = _collect_aliases(module)

    # Refuse aliased `from datetime import timezone as <X>` -- out of scope.
    # TODO(v0.4): rewrite aliased forms too (`from datetime import timezone as
    # tz` → introduce a sibling `from datetime import UTC as <name>` or
    # rewrite `<X>.utc` to `<X>.UTC` if the alias is the only user, etc.).
    if aliased_timezone:
        # If the file ALSO contains a bare `from datetime import timezone`,
        # the unaliased form could in principle be rewritten -- but we'd then
        # leave the aliased form behind and the file would have inconsistent
        # idioms (`UTC` from one import, `<alias>.utc` still in use). Surface
        # that explicitly in the reason so users know nothing was rewritten.
        if bare_timezone:
            reason = (
                "aliased `from datetime import timezone as <alias>` not yet "
                "supported in v0.3 (the unaliased `from datetime import "
                "timezone` on this file was also skipped to keep the file "
                "consistent -- see TODO(v0.4) in datetime_utc_alias.py)."
            )
        else:
            reason = (
                "aliased `from datetime import timezone as <alias>` not yet "
                "supported in v0.3 (rewrite tracked as a v0.4 follow-up; see "
                "TODO(v0.4) in datetime_utc_alias.py)."
            )
        emit(
            ok=True,
            new_content="",
            preconditions=[
                {
                    "id": "aliased_import_unsupported",
                    "satisfied": False,
                    "reason": reason,
                }
            ],
        )
        return

    if not dt_module_aliases and not bare_timezone:
        # No reachable form to rewrite.
        emit(ok=True, new_content="", preconditions=[])
        return

    rewriter = _UtcRewriter(dt_module_aliases, bare_timezone)
    new_module = module.visit(rewriter)
    if not rewriter.changed:
        emit(ok=True, new_content="", preconditions=[])
        return

    # If we rewrote any bare `timezone.utc`, the import line for
    # `from datetime import ...` needs to gain `UTC` (and possibly lose
    # `timezone`). We only run the import-rewriter when there's an actual
    # `timezone` import to touch; the module-attribute form
    # (`datetime.timezone.utc` -> `datetime.UTC`) needs no import changes.
    if rewriter.rewrote_bare_timezone_utc:
        # Count remaining `timezone` references in the rewritten tree. If
        # zero, the import can drop `timezone`; otherwise we keep it and
        # add `UTC` alongside.
        remaining = _count_bare_timezone_references(new_module)
        import_pass = _ImportFromRewriter(
            drop_timezone=(remaining == 0),
            add_utc=True,
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
