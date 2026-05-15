"""checker.py — exact coverage checker for the format-to-fstring transform.

Inputs:
    --fixture <dir>       Path to the (modified) fixture directory.
    --expected <dir>      Path to the original (unmodified) fixture dir,
                          containing *.expected.json sidecars.
    --details             Emit a per-site `details` array on stdout.

Output (stdout):
    JSON {correct, missed, wrong, broken_syntax, total_planted}
    plus an optional `details` array.

------------------------------------------------------------------------------
Why this checker does NOT match on line numbers
------------------------------------------------------------------------------
When a tool rewrites a file, line numbers shift: an earlier conversion that
collapses a multi-line call moves every subsequent site. Proximity matching
("the f-string nearest line N") then mis-classifies — a correctly skipped site
gets blamed on a different nearby conversion. That makes every bench number
suspect.

Instead, every planted site is anchored to a STABLE identifier that survives
line drift:

    anchor = (enclosing function name, occurrence index)

`occurrence` is the 0-based position of the formatting expression among ALL
formatting expressions of that function, in source order. A "formatting
expression" is any of:

    - a `.format(...)` call               (str.format style)
    - a `%` BinaryOperation               (percent style OR integer modulo)
    - a `FormattedString`                 (an f-string)

This anchor is exact because:

  * Function names are unique within a fixture file and unchanged by these
    transforms (the transform only rewrites the formatting expression, never
    renames or reorders functions).
  * Variable/argument renames don't happen, so a function's body keeps the
    same number of formatting expressions in the same source order.
  * A transform only changes the *kind* of a node (`.format()` -> f-string,
    `%` -> f-string); it never inserts, deletes, or reorders formatting
    expressions. So occurrence index 2 before the run is occurrence index 2
    after the run — pointing at the exact same site.

The `*.expected.json` sidecars carry `function` and `occurrence` fields for
this purpose (migrated from the original line-only form). `line` is kept for
human readability only and is never used for classification.

Classification, per site, after locating the node via its anchor:

    correct        - expected == "f-string" and the node is now an f-string;
                     OR expected == "skip" and the node is unchanged
                     (still `.format()` / `%`).
                     If the site has an `alt` outcome, producing `alt`
                     also counts as correct.
    missed         - expected was a rewrite but the node is unchanged.
    wrong          - the node was rewritten to something other than an
                     accepted outcome (e.g. an f-string where skip was
                     required and skip is the only accepted outcome).
    broken_syntax  - the file no longer parses.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional

import libcst as cst
from libcst import metadata


# ---------------------------------------------------------------------------
# Formatting-expression collection

# A formatting expression is classified into one of three observable kinds.
KIND_FORMAT = "format"      # a surviving `.format(...)` call
KIND_PERCENT = "percent"    # a surviving `%` BinaryOperation
KIND_FSTRING = "fstring"    # a FormattedString (f-string)


def _is_format_call(node: cst.CSTNode) -> bool:
    """True for `<anything>.format(...)` calls."""
    return (
        isinstance(node, cst.Call)
        and isinstance(node.func, cst.Attribute)
        and isinstance(node.func.attr, cst.Name)
        and node.func.attr.value == "format"
    )


class _FormattingCollector(cst.CSTVisitor):
    """Collect, per enclosing function, the source-ordered list of formatting
    expressions. Each entry records the observable kind only — the checker
    never needs the node itself once it has the kind.
    """

    METADATA_DEPENDENCIES = (metadata.PositionProvider,)

    def __init__(self) -> None:
        super().__init__()
        self._fn_stack: List[str] = []
        # function name -> list of (line, column, kind)
        self._raw: Dict[str, List[tuple]] = {}

    def visit_FunctionDef(self, node: cst.FunctionDef) -> bool:
        self._fn_stack.append(node.name.value)
        return True

    def leave_FunctionDef(self, node: cst.FunctionDef) -> None:
        self._fn_stack.pop()

    def _record(self, node: cst.CSTNode, kind: str) -> None:
        if not self._fn_stack:
            return  # module-level formatting; no fixture plants these
        pos = self.get_metadata(metadata.PositionProvider, node)
        self._raw.setdefault(self._fn_stack[-1], []).append(
            (pos.start.line, pos.start.column, kind)
        )

    def visit_Call(self, node: cst.Call) -> bool:
        if _is_format_call(node):
            self._record(node, KIND_FORMAT)
        return True

    def visit_BinaryOperation(self, node: cst.BinaryOperation) -> bool:
        # Every `%` BinaryOperation is a candidate site: string-formatting and
        # plain integer modulo both look like `%`. The expected.json `kind`
        # tells us which the planter intended; the fixture's modulo site is
        # legitimately `expected: skip`.
        if isinstance(node.operator, cst.Modulo):
            self._record(node, KIND_PERCENT)
        return True

    def visit_FormattedString(self, node: cst.FormattedString) -> bool:
        self._record(node, KIND_FSTRING)
        return True

    def by_function(self) -> Dict[str, List[str]]:
        """Return {function: [kind, kind, ...]} in source order."""
        out: Dict[str, List[str]] = {}
        for fn, entries in self._raw.items():
            ordered = sorted(entries, key=lambda t: (t[0], t[1]))
            out[fn] = [kind for (_line, _col, kind) in ordered]
        return out


def collect_formatting(mod: cst.Module) -> Dict[str, List[str]]:
    """Map each function name to its source-ordered list of formatting-expr
    kinds.
    """
    collector = _FormattingCollector()
    metadata.MetadataWrapper(mod).visit(collector)
    return collector.by_function()


# ---------------------------------------------------------------------------
# Classification


def _accepted_outcomes(site: dict) -> set:
    """The set of expected.json outcomes ("f-string" / "skip") that count as
    correct for this site — the primary `expected` plus an optional `alt`.
    """
    accepted = {site["expected"]}
    if site.get("alt"):
        accepted.add(site["alt"])
    return accepted


def classify_file(
    fixture_path: Path, expected_sites: List[dict]
) -> tuple[int, int, int, int, List[dict]]:
    """Return (correct, missed, wrong, broken_syntax, details_list)."""
    correct = missed = wrong = broken = 0
    details: List[dict] = []

    def push(site: dict, actual: str, verdict: str) -> None:
        details.append(
            {
                "file": fixture_path.name,
                "function": site.get("function"),
                "occurrence": site.get("occurrence"),
                "line": site.get("line"),
                "kind": site.get("kind"),
                "expected": site["expected"],
                "actual": actual,
                "verdict": verdict,
            }
        )

    if not fixture_path.exists():
        for s in expected_sites:
            missed += 1
            push(s, "file-missing", "missed")
        return correct, missed, wrong, broken, details

    src = fixture_path.read_text()
    try:
        mod = cst.parse_module(src)
    except Exception as exc:  # noqa: BLE001 -- broken syntax IS the data
        for s in expected_sites:
            broken += 1
            push(s, f"parse-error:{exc.__class__.__name__}", "broken_syntax")
        return correct, missed, wrong, broken, details

    by_fn = collect_formatting(mod)

    for site in expected_sites:
        fn = site["function"]
        occ = site["occurrence"]
        accepted = _accepted_outcomes(site)

        kinds = by_fn.get(fn, [])
        actual_kind: Optional[str] = kinds[occ] if 0 <= occ < len(kinds) else None

        if actual_kind is None:
            # The anchored formatting expression vanished entirely. A transform
            # that does its job never deletes a formatting expression, so this
            # means the rewrite was lossy / structurally broken at this site.
            actual_label = "removed"
            verdict = "wrong"
        else:
            # Map the observed AST kind to an expected.json outcome vocabulary.
            actual_outcome = "f-string" if actual_kind == KIND_FSTRING else "skip"
            actual_label = "f-string" if actual_kind == KIND_FSTRING else site["kind"]
            if actual_outcome in accepted:
                verdict = "correct"
            elif actual_outcome == "skip":
                # Expected a rewrite (f-string), site left unchanged.
                verdict = "missed"
            else:
                # Site rewritten to an f-string when only `skip` was acceptable.
                verdict = "wrong"

        if verdict == "correct":
            correct += 1
        elif verdict == "missed":
            missed += 1
        else:
            wrong += 1
        push(site, actual_label, verdict)

    return correct, missed, wrong, broken, details


# ---------------------------------------------------------------------------
# Driver


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--fixture", required=True)
    p.add_argument("--expected", required=True)
    p.add_argument("--details", action="store_true")
    args = p.parse_args()

    fixture_dir = Path(args.fixture)
    expected_dir = Path(args.expected)

    expected_files: Dict[str, List[dict]] = {}
    for jf in sorted(expected_dir.glob("*.expected.json")):
        with jf.open() as f:
            obj = json.load(f)
        expected_files[obj["file"]] = obj["sites"]

    correct = missed = wrong = broken = total = 0
    all_details: List[dict] = []

    for filename, sites in expected_files.items():
        total += len(sites)
        c, m_, w, b, dets = classify_file(fixture_dir / filename, sites)
        correct += c
        missed += m_
        wrong += w
        broken += b
        all_details.extend(dets)

    out = {
        "correct": correct,
        "missed": missed,
        "wrong": wrong,
        "broken_syntax": broken,
        "total_planted": total,
    }
    if args.details:
        out["details"] = all_details
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
