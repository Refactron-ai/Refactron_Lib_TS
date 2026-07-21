"""Report unresolvable top-level imports per file.

Usage: imports_check.py <project_root> <file> [<file>...]

For each file, prints one line per unresolvable top-level module:

    UNRESOLVED\t<path>\t<module>

<path> is echoed back exactly as passed on argv, so the caller can map each
result to the base or shadow file it handed in. A file with no unresolvable
imports produces no lines. The script always exits 0 once analysis runs; the
caller decides what counts as a failure (it diffs base vs changed). Exit 2 is
reserved for a usage error.

Two behaviours matter for real-world code:

1. Imports guarded by ``if TYPE_CHECKING:`` never execute at runtime, so the
   module need not be installed. We do not descend into the body of such an
   ``if`` (both the bare ``TYPE_CHECKING`` and attribute ``x.TYPE_CHECKING``
   forms, plus ``... and TYPE_CHECKING`` compounds). The ``else`` branch of
   such a guard DOES run at runtime, so it is still analyzed.
2. Every unresolvable import in a file is reported, not just the first, so the
   caller can compute the exact delta introduced by a change.

Stdlib only (Python 3.8+ floor); no third-party imports.
"""
import ast
import importlib.util
import sys


def _is_type_checking_test(test):
    """True if `test` is a TYPE_CHECKING guard whose body is dead at runtime."""
    # Bare name: `if TYPE_CHECKING:`
    if isinstance(test, ast.Name) and test.id == "TYPE_CHECKING":
        return True
    # Attribute: `if t.TYPE_CHECKING:` / `if typing.TYPE_CHECKING:`
    if isinstance(test, ast.Attribute) and test.attr == "TYPE_CHECKING":
        return True
    # Compound `and`: the whole guard is dead at runtime if any operand is a
    # TYPE_CHECKING test (since TYPE_CHECKING is False at runtime, `X and
    # TYPE_CHECKING` can never be truthy). `or` is deliberately NOT treated as
    # a guard, because the block can still run when the other operand is true.
    if isinstance(test, ast.BoolOp) and isinstance(test.op, ast.And):
        return any(_is_type_checking_test(v) for v in test.values)
    return False


def _collect_import_names(tree):
    """Return every top-level import name reachable at runtime.

    Iterative (explicit stack) to avoid Python's recursion limit on deeply
    nested source. Skips the body of TYPE_CHECKING-guarded ``if`` nodes but
    still analyzes their ``else`` branch.
    """
    names = []
    stack = list(ast.iter_child_nodes(tree))
    while stack:
        node = stack.pop()
        if isinstance(node, ast.If) and _is_type_checking_test(node.test):
            # Skip the guarded body (and the test expression); the else branch
            # runs at runtime, so keep analyzing it.
            stack.extend(node.orelse)
            continue
        if isinstance(node, ast.Import):
            names.extend(a.name for a in node.names)
            continue
        if isinstance(node, ast.ImportFrom):
            # Relative imports (level > 0) resolve within the package tree, not
            # via find_spec; the tests gate covers those. Only absolute
            # `from X import ...` is checked here.
            if node.level == 0 and node.module:
                names.append(node.module)
            continue
        stack.extend(ast.iter_child_nodes(node))
    return names


def _unresolvable(names):
    """Return the sorted, de-duplicated top-level modules that do not resolve."""
    bad = set()
    seen = set()
    for name in names:
        top = name.split(".")[0]
        if top in seen:
            continue
        seen.add(top)
        try:
            spec = importlib.util.find_spec(top)
        except Exception:
            # A parent package that raises on lookup is treated as unresolvable;
            # conservative, and the delta logic still forgives it if the same
            # failure exists in the base file.
            spec = None
        if spec is None:
            bad.add(top)
    return sorted(bad)


def main(argv):
    if len(argv) < 3:
        sys.stderr.write("usage: imports_check.py <project_root> <file> [<file>...]\n")
        return 2

    root, files = argv[1], argv[2:]
    sys.path.insert(0, root)

    out = []
    for path in files:
        try:
            with open(path, "r", encoding="utf-8") as f:
                tree = ast.parse(f.read(), filename=path)
        except (OSError, SyntaxError):
            # Unreadable/unparseable file -> no determinable imports. The syntax
            # gate runs before this one for changed files; a base file that
            # cannot be parsed simply contributes an empty baseline.
            continue
        for top in _unresolvable(_collect_import_names(tree)):
            out.append("UNRESOLVED\t{}\t{}".format(path, top))

    if out:
        sys.stdout.write("\n".join(out) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
