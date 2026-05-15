"""checker.py — coverage checker for format-to-fstring.

Inputs:
    --fixture <dir>       Path to the (modified) fixture directory.
    --expected <dir>      Path to the original (unmodified) fixture dir,
                          containing *.expected.json sidecars.

For each f<NN>.py file:
    - parse with libcst
    - walk every Call/BinaryOp node and classify whether each expected site
      was correctly rewritten to an f-string, missed, or wrongly rewritten
      (e.g. on a site we said should be skipped).

Output (stdout):
    JSON {correct, missed, wrong, broken_syntax, total_planted}
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import List

import libcst as cst
from libcst import matchers as m


# ---------------------------------------------------------------------------
# Helpers


def find_format_call_lines(mod: cst.Module, wrapper) -> List[int]:
    """Return 1-indexed start lines of `"...".format(...)` calls.

    A site is considered surviving (= the codemod did NOT rewrite it) if such
    a call still exists in the rewritten file.
    """
    lines: List[int] = []
    for node in m.findall(
        mod,
        m.Call(func=m.Attribute(attr=m.Name("format"))),
    ):
        # We don't constrain the receiver kind; .format on anything counts as
        # a surviving formatting site (if it's on a literal it's "rewritable
        # but skipped"; on a var it's "out of reach" -- both look identical
        # from the rewritten file).
        pos = wrapper.resolve(cst.metadata.PositionProvider).get(node)
        if pos is None:
            continue
        lines.append(pos.start.line)
    return lines


def find_pct_format_lines(mod: cst.Module, wrapper) -> List[int]:
    """Return 1-indexed start lines of `<str> % <expr>` BinaryOperation sites."""
    lines: List[int] = []
    for node in m.findall(
        mod,
        m.BinaryOperation(operator=m.Modulo()),
    ):
        # Filter: must be string-formatting (LHS is a string-ish expression).
        # Best effort: detect if LHS is a SimpleString or ConcatenatedString
        # or FormattedString. Modulo on numbers (= arithmetic) is excluded.
        left = node.left
        if isinstance(left, (cst.SimpleString, cst.ConcatenatedString)):
            pos = wrapper.resolve(cst.metadata.PositionProvider).get(node)
            if pos is None:
                continue
            lines.append(pos.start.line)
    return lines


def find_fstring_lines(mod: cst.Module, wrapper) -> List[int]:
    lines: List[int] = []
    for node in m.findall(mod, m.FormattedString()):
        pos = wrapper.resolve(cst.metadata.PositionProvider).get(node)
        if pos is None:
            continue
        lines.append(pos.start.line)
    return lines


# ---------------------------------------------------------------------------
# Classification


def closest(target_line: int, candidates: List[int], tolerance: int = 4) -> int | None:
    """Find the candidate line closest to target_line, within tolerance."""
    best = None
    best_d = tolerance + 1
    for c in candidates:
        d = abs(c - target_line)
        if d < best_d:
            best_d = d
            best = c
    return best


def classify_file(
    fixture_path: Path, expected_sites: list[dict]
) -> tuple[int, int, int, int, list[dict]]:
    """Return (correct, missed, wrong, broken_syntax, details_list)."""
    correct = missed = wrong = broken = 0
    details: list[dict] = []

    if not fixture_path.exists():
        for s in expected_sites:
            missed += 1
            details.append({"file": fixture_path.name, "line": s["line"], "expected": s["expected"], "actual": "file-missing", "verdict": "missed"})
        return correct, missed, wrong, broken, details

    src = fixture_path.read_text()
    try:
        mod = cst.parse_module(src)
    except Exception as exc:  # noqa: BLE001 -- broken syntax IS the data
        for s in expected_sites:
            broken += 1
            details.append({"file": fixture_path.name, "line": s["line"], "expected": s["expected"], "actual": f"parse-error:{exc.__class__.__name__}", "verdict": "broken_syntax"})
        return correct, missed, wrong, broken, details

    wrapper = cst.metadata.MetadataWrapper(mod)
    wrapped_mod = wrapper.module
    fmt_lines = find_format_call_lines(wrapped_mod, wrapper)
    pct_lines = find_pct_format_lines(wrapped_mod, wrapper)
    fstr_lines = find_fstring_lines(wrapped_mod, wrapper)

    used_fmt: set[int] = set()
    used_pct: set[int] = set()
    used_fstr: set[int] = set()

    for site in expected_sites:
        line = site["line"]
        kind = site["kind"]
        expected = site["expected"]

        fstr_match = closest(line, [l for l in fstr_lines if l not in used_fstr])
        if "format" in kind:
            survivor = closest(line, [l for l in fmt_lines if l not in used_fmt])
        elif "%" in kind:
            survivor = closest(line, [l for l in pct_lines if l not in used_pct])
        else:
            survivor = None

        actual_label = "no-change"
        verdict = "missed"

        if expected == "f-string":
            if fstr_match is not None and survivor is None:
                verdict = "correct"
                actual_label = "f-string"
                used_fstr.add(fstr_match)
            elif fstr_match is not None and survivor is not None:
                # Both an f-string and the original survive nearby; pick the
                # closer one and credit accordingly.
                if abs(fstr_match - line) <= abs(survivor - line):
                    verdict = "correct"
                    actual_label = "f-string"
                    used_fstr.add(fstr_match)
                else:
                    verdict = "missed"
                    actual_label = kind
                    if "%" in kind:
                        used_pct.add(survivor)
                    else:
                        used_fmt.add(survivor)
            else:
                verdict = "missed"
                actual_label = kind
                if survivor is not None:
                    if "%" in kind:
                        used_pct.add(survivor)
                    else:
                        used_fmt.add(survivor)
        elif expected == "skip":
            if survivor is not None and fstr_match is None:
                verdict = "correct"
                actual_label = kind
                if "%" in kind:
                    used_pct.add(survivor)
                else:
                    used_fmt.add(survivor)
            elif fstr_match is not None:
                verdict = "wrong"
                actual_label = "f-string"
                used_fstr.add(fstr_match)
            else:
                verdict = "wrong"
                actual_label = "removed"
        else:
            verdict = "missed"

        if verdict == "correct":
            correct += 1
        elif verdict == "wrong":
            wrong += 1
        else:
            missed += 1

        details.append(
            {
                "file": fixture_path.name,
                "line": line,
                "kind": kind,
                "expected": expected,
                "actual": actual_label,
                "verdict": verdict,
            }
        )

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

    # Load every *.expected.json from expected_dir.
    expected_files = {}
    for jf in sorted(expected_dir.glob("*.expected.json")):
        with jf.open() as f:
            obj = json.load(f)
        expected_files[obj["file"]] = obj["sites"]

    correct = missed = wrong = broken = total = 0
    all_details: list[dict] = []

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
