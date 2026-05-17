import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _base import read_source, emit  # noqa: E402
from _cross_file import load_cross_file  # noqa: E402

import libcst as cst  # noqa: E402
import libcst.matchers as m  # noqa: E402

MAPPING = {"requests": "httpx"}

# httpx is a safe drop-in for `requests` ONLY for the HTTP verb helpers below
# (`httpx.get(...)` etc. accept the same common kwargs). Everything else
# diverges: `httpx.Timeout` is a *config class*, not an exception (the
# exception is `TimeoutException`); `httpx.ConnectionError` does not exist
# (it is `ConnectError`); `requests.Session` maps to `httpx.Client`; the
# `requests.exceptions` submodule has no httpx equivalent. Blindly renaming
# `requests.X` -> `httpx.X` for those emits code that fails at runtime, so we
# refuse the whole file instead -- over-skip beats under-skip.
SAFE_HTTPX_DROP_INS = {
    "get",
    "post",
    "put",
    "delete",
    "patch",
    "head",
    "options",
    "request",
}


def find_unsafe_api_refs(module: cst.Module, aliases: dict) -> list:
    """Return the sorted `requests` API names referenced in this module that
    are NOT safe httpx drop-ins -- attribute access on a `requests` local, or
    a bare name pulled in via `from requests import ...`.
    """
    unsafe = set()
    for attr in m.findall(module, m.Attribute()):
        base = attr.value
        if isinstance(base, cst.Name) and base.value in aliases:
            name = attr.attr.value
            if name not in SAFE_HTTPX_DROP_INS:
                unsafe.add(name)
    for imp in m.findall(module, m.ImportFrom()):
        if imp.module is None or _name_to_str(imp.module) not in MAPPING:
            continue
        if isinstance(imp.names, cst.ImportStar):
            unsafe.add("*")
            continue
        for alias in imp.names:
            if (
                isinstance(alias.name, cst.Name)
                and alias.name.value not in SAFE_HTTPX_DROP_INS
            ):
                unsafe.add(alias.name.value)
    return sorted(unsafe)


def module_name_from_path(rel_path):
    """`legacy_http.py` -> `legacy_http`. `pkg/foo.py` -> `pkg.foo`. Drops `__init__`."""
    no_ext = rel_path[:-3] if rel_path.endswith(".py") else rel_path
    parts = no_ext.replace("\\", "/").split("/")
    if parts and parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


def find_external_string_refs(this_rel_path, deprecated_module_name, cross_file):
    """Return external relpaths that reference `<this_module>.<deprecated_module>` in any
    context — attribute access, string literal inside `patch(...)`, anything. Conservative
    string scan; over-skip beats under-skip.
    """
    if not cross_file:
        return []
    this_mod = module_name_from_path(this_rel_path)
    if not this_mod:
        return []
    pattern = re.compile(
        r"\b" + re.escape(this_mod) + r"\." + re.escape(deprecated_module_name) + r"\b"
    )
    refs = []
    for rel, content in (cross_file.get("files") or {}).items():
        if rel == this_rel_path:
            continue
        if pattern.search(content):
            refs.append(rel)
    return refs


def _name_to_str(node) -> str:
    """Render a Name or dotted Attribute import target as a dotted string."""
    if isinstance(node, cst.Name):
        return node.value
    if isinstance(node, cst.Attribute):
        return _name_to_str(node.value) + "." + node.attr.value
    return ""


def _str_to_name(dotted: str):
    parts = dotted.split(".")
    node = cst.Name(parts[0])
    for p in parts[1:]:
        node = cst.Attribute(value=node, attr=cst.Name(p))
    return node


def collect_aliases(module: cst.Module) -> dict:
    """Build {local_name -> new_module_name} for any alias whose source module
    is in MAPPING.
    """
    aliases: dict = {}
    for imp in m.findall(module, m.Import()):
        for alias in imp.names:
            mod_name = _name_to_str(alias.name)
            if mod_name in MAPPING:
                if alias.asname is not None and isinstance(alias.asname.name, cst.Name):
                    local = alias.asname.name.value
                else:
                    # `import requests` binds top-level name `requests`
                    local = mod_name.split(".")[0]
                aliases[local] = MAPPING[mod_name]
    return aliases


def _target_already_imported(module: cst.Module, target: str) -> bool:
    for imp in m.findall(module, m.Import()):
        for alias in imp.names:
            if _name_to_str(alias.name) == target:
                return True
    for imp in m.findall(module, m.ImportFrom()):
        if imp.module is not None and _name_to_str(imp.module) == target:
            return True
    return False


class RewriteImports(cst.CSTTransformer):
    def __init__(self):
        self.changed = False

    def leave_Import(self, original: cst.Import, updated: cst.Import) -> cst.Import:
        new_names = []
        for alias in updated.names:
            mod_name = _name_to_str(alias.name)
            if mod_name in MAPPING:
                new_names.append(alias.with_changes(name=_str_to_name(MAPPING[mod_name])))
                self.changed = True
            else:
                new_names.append(alias)
        return updated.with_changes(names=tuple(new_names))

    def leave_ImportFrom(
        self, original: cst.ImportFrom, updated: cst.ImportFrom
    ) -> cst.ImportFrom:
        if updated.module is None:
            return updated
        mod_name = _name_to_str(updated.module)
        if mod_name in MAPPING:
            self.changed = True
            return updated.with_changes(module=_str_to_name(MAPPING[mod_name]))
        return updated


class RewriteCalls(cst.CSTTransformer):
    """Rewrite `obj.attr` where obj is a local Name resolving to a deprecated module."""

    def __init__(self, aliases: dict):
        # aliases: {local_name -> new_module_name}
        self.aliases = aliases
        self.changed = False

    def leave_Attribute(
        self, original: cst.Attribute, updated: cst.Attribute
    ) -> cst.Attribute:
        if isinstance(updated.value, cst.Name) and updated.value.value in self.aliases:
            new_local = self.aliases[updated.value.value]
            # Only rewrite if the alias was a default-style import (`import requests`).
            # If user did `import requests as r`, they kept `r` and we should NOT
            # rename `r` itself. The `RewriteImports` step already changed the
            # underlying module name.
            if updated.value.value == new_local:
                return updated
            # If the local matches the original module name (e.g. local == "requests"),
            # rewrite it to the new module name. Otherwise leave it (alias preserved).
            # We detect "local matches an original key in MAPPING".
            for src_mod, tgt_mod in MAPPING.items():
                if updated.value.value == src_mod and tgt_mod == new_local:
                    self.changed = True
                    return updated.with_changes(value=cst.Name(new_local))
        return updated


def main():
    if len(sys.argv) < 2:
        emit(ok=False, error="usage: deprecated_api.py <file> [cross_file_json]")
        return
    path = sys.argv[1]
    cross_file = load_cross_file(2)
    src = read_source(path)
    try:
        module = cst.parse_module(src)
    except cst.ParserSyntaxError as e:
        emit(ok=False, error=f"parse error: {e}")
        return

    # Determine this file's project-relative path from the cross-file context.
    this_rel = None
    if cross_file:
        root = cross_file.get("projectRoot") or ""
        if root and path.startswith(root):
            this_rel = os.path.relpath(path, root).replace(os.sep, "/")

    aliases = collect_aliases(module)
    # Also detect from-imports of deprecated modules (they don't introduce module aliases
    # but they still need rewriting and should also be gated by the precondition).
    has_from = False
    for imp in m.findall(module, m.ImportFrom()):
        if imp.module is not None and _name_to_str(imp.module) in MAPPING:
            has_from = True
            break

    if not aliases and not has_from:
        # Nothing to rewrite.
        emit(ok=True, new_content="", preconditions=[])
        return

    # Precondition: target must not already be imported.
    preconditions = []
    blocked = False
    targets = set()
    for local, tgt in aliases.items():
        targets.add(tgt)
    for imp in m.findall(module, m.ImportFrom()):
        if imp.module is not None and _name_to_str(imp.module) in MAPPING:
            targets.add(MAPPING[_name_to_str(imp.module)])
    for tgt in targets:
        if _target_already_imported(module, tgt):
            preconditions.append(
                {
                    "id": f"no-target-already:{tgt}",
                    "satisfied": False,
                    "reason": f"target module {tgt} already imported",
                }
            )
            blocked = True

    # Cross-file precondition: if any external file references `<this_module>.<deprecated_module>`
    # (attribute access, string literal in `patch(...)`, etc.), refuse to rewrite.
    if this_rel and cross_file:
        for deprecated_module in MAPPING.keys():
            refs = find_external_string_refs(this_rel, deprecated_module, cross_file)
            if refs:
                preconditions.append(
                    {
                        "id": f"external-string-refs:{deprecated_module}",
                        "satisfied": False,
                        "reason": (
                            f"module {deprecated_module} referenced from "
                            f"{len(refs)} external file(s): {','.join(refs[:3])}"
                        ),
                    }
                )
                blocked = True

    # API-surface precondition: refuse if the file touches `requests` API that
    # is not a safe httpx drop-in (exceptions, Session, the exceptions
    # submodule, ...). A blind rename of those produces runtime-broken code.
    unsafe_attrs = find_unsafe_api_refs(module, aliases)
    if unsafe_attrs:
        preconditions.append(
            {
                "id": "unsafe-api-surface",
                "satisfied": False,
                "reason": (
                    "requests API used here is not a safe httpx drop-in: "
                    + ", ".join(unsafe_attrs)
                    + " (httpx diverges on exceptions, Session, etc.)"
                ),
            }
        )
        blocked = True

    if blocked:
        emit(ok=True, new_content="", preconditions=preconditions)
        return

    imp_pass = RewriteImports()
    new_module = module.visit(imp_pass)
    call_pass = RewriteCalls(aliases)
    new_module = new_module.visit(call_pass)

    if not imp_pass.changed and not call_pass.changed:
        emit(ok=True, new_content="", preconditions=preconditions)
        return

    preconditions.append({"id": "rewritten", "satisfied": True})
    emit(ok=True, new_content=new_module.code, preconditions=preconditions)


if __name__ == "__main__":
    main()
