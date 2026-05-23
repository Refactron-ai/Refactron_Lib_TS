"""Resolve the project's minimum Python version from the cross-file context.

Refactron's TS engine resolves `pythonVersion` once per run (config →
`pyproject.toml` → unknown) and serializes it into the cross-file JSON. This
helper hands the value to version-gated Python sidecars (PEP 585 / 604,
`lru_cache` → `cache`, `datetime.UTC`, ...) with a uniform API:

    from _python_version import min_version, at_least

    if not at_least(cross_file, 3, 9):
        emit(ok=True, new_content="", preconditions=[{
            "id": "python_version_too_low",
            "satisfied": False,
            "reason": "transform requires Python >= 3.9; project targets <3.9",
        }])
        return

Resolution rules:
- `cross_file["pythonVersion"]` is a string like `"3.10"` (or absent/None).
- An absent / unparsable value means "unknown" — `min_version` returns `None`
  and `at_least` returns False. We deliberately do NOT default to a permissive
  Python in `at_least` — over-skip beats emitting code that won't run on the
  project's interpreter.
"""

from __future__ import annotations


def min_version(cross_file):
    """Return (major, minor) parsed from cross_file['pythonVersion'], or None."""
    if not cross_file:
        return None
    raw = cross_file.get("pythonVersion")
    if not raw or not isinstance(raw, str):
        return None
    parts = raw.split(".")
    if len(parts) < 2:
        return None
    try:
        return (int(parts[0]), int(parts[1]))
    except ValueError:
        return None


def at_least(cross_file, major: int, minor: int) -> bool:
    """True iff the project's minimum Python version is >= (major, minor).

    Returns False when the version is unknown — gated transforms must refuse
    rather than guess. The TS resolver tries config → pyproject.toml; if both
    are silent the project is treated as "could be Python 3.8" (which has none
    of the v0.3.0 gated features).
    """
    v = min_version(cross_file)
    if v is None:
        return False
    return (v[0], v[1]) >= (major, minor)
