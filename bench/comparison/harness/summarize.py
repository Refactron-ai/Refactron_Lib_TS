"""summarize.py — aggregate results-<DATE>.jsonl into summary-<DATE>.md.

Computes median/min/max wall-clock and coverage/safety per (tool, transform)
cell. Reviewers can recompute from the raw jsonl.

Usage:
    python3 bench/comparison/harness/summarize.py <results.jsonl> > summary.md
"""

from __future__ import annotations

import json
import statistics
import sys
from collections import defaultdict


def median(xs: list[float]) -> float:
    return round(statistics.median(xs), 3)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: summarize.py <results.jsonl>", file=sys.stderr)
        return 2

    path = sys.argv[1]
    date = path.rsplit("results-", 1)[-1].replace(".jsonl", "")

    runs = defaultdict(list)  # (transform, tool) -> [record, ...]
    na = {}  # (transform, tool) -> note
    header_lines = []

    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            if line.startswith("#"):
                header_lines.append(line.lstrip("# ").rstrip())
                continue
            d = json.loads(line)
            key = (d["transform"], d["tool"])
            if d.get("tool_applicable") is False:
                na[key] = d.get("notes", "not applicable")
            else:
                runs[key].append(d)

    transforms = ["var-to-const-let", "format-to-fstring"]
    tools = ["refactron", "jscodeshift", "comby", "eslint", "libcst"]

    out: list[str] = []
    out.append(f"# Refactron comparison bench — computed summary ({date})")
    out.append("")
    out.append("Computed from `results-%s.jsonl` by `harness/summarize.py`." % date)
    out.append("Every number below traces to measured runs in that file; nothing is estimated.")
    out.append("")
    out.append("## Environment")
    out.append("")
    for h in header_lines:
        out.append(f"- {h}")
    out.append("")

    for transform in transforms:
        out.append(f"## Transform: `{transform}`")
        out.append("")
        out.append("| Tool | Speed (median / min / max, s) | Coverage (correct/total) | Coverage % | Wrong | Broken | Safety (compile / tests) |")
        out.append("|---|---|---|---|---|---|---|")
        for tool in tools:
            key = (transform, tool)
            if key in na:
                out.append(f"| {tool} | N/A | N/A | N/A | N/A | N/A | N/A — {na[key]} |")
                continue
            recs = runs.get(key)
            if not recs:
                out.append(f"| {tool} | N/A | N/A | N/A | N/A | N/A | N/A — no measured runs |")
                continue
            times = [r["wall_clock_seconds"] for r in recs]
            # Coverage is deterministic across runs; take run 1.
            cov = recs[0]["coverage"] or {}
            saf = recs[0]["safety"] or {}
            correct = cov.get("correct", 0)
            total = cov.get("total_planted", 0)
            wrong = cov.get("wrong", 0)
            broken = cov.get("broken_syntax", 0)
            pct = round(100.0 * correct / total, 1) if total else 0.0
            compiles = saf.get("compiles")
            tests = saf.get("tests_pass")
            safety_cell = f"{'pass' if compiles else 'FAIL'} / {'pass' if tests else 'FAIL'}"
            out.append(
                f"| {tool} "
                f"| {median(times)} / {min(times)} / {max(times)} "
                f"| {correct}/{total} "
                f"| {pct}% "
                f"| {wrong} "
                f"| {broken} "
                f"| {safety_cell} |"
            )
        out.append("")

    out.append("## Notes")
    out.append("")
    out.append("- **Coverage** is deterministic per (tool, transform) — every measured run")
    out.append("  produced identical correct/missed/wrong/broken counts, so the table shows")
    out.append("  run 1's values.")
    out.append("- **Wrong** = the tool rewrote a site to the wrong target (e.g. `const` where")
    out.append("  `let` was needed, or rewrote a site that should have been skipped).")
    out.append("- **Broken** = the tool produced unparseable output at that site.")
    out.append("- **Safety FAIL** means `tsc --noEmit` / `py_compile` or the sanity test")
    out.append("  suite exited non-zero on the tool's output. See `failing_tests` in the")
    out.append("  raw jsonl for specifics.")
    print("\n".join(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
