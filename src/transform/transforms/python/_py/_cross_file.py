"""Shared helper for sidecars to read the optional cross-file JSON context."""

import json
import sys


def load_cross_file(arg_index: int = 2):
    """Return the CrossFileContext dict if argv[arg_index] is a readable JSON path; else None."""
    if len(sys.argv) <= arg_index:
        return None
    cf_path = sys.argv[arg_index]
    if not cf_path:
        return None
    try:
        with open(cf_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None
