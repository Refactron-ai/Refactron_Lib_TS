"""Shared I/O contract for Refactron transform sidecars."""
import json, sys


def read_source(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def emit(ok: bool, new_content: str = "", preconditions=None, error: str = None) -> None:
    out = {"ok": ok}
    if ok:
        out["newContent"] = new_content
        out["preconditions"] = preconditions or []
    else:
        out["error"] = error or "unknown error"
    sys.stdout.write(json.dumps(out))
    sys.stdout.write("\n")
    sys.exit(0 if ok else 1)
