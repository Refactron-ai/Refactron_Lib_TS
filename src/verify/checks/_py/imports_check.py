"""Resolve every top-level import in each path. Print "OK" or "ERR <path>:<module>"."""
import ast, importlib.util, sys, os

if len(sys.argv) < 3:
    print("ERR usage: imports_check.py <project_root> <file> [<file>...]")
    sys.exit(2)

root, files = sys.argv[1], sys.argv[2:]
sys.path.insert(0, root)

for path in files:
    with open(path, "r", encoding="utf-8") as f:
        tree = ast.parse(f.read(), filename=path)
    for node in ast.walk(tree):
        names = []
        if isinstance(node, ast.Import):
            names = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            if node.level > 0:
                continue
            if node.module:
                names = [node.module]
        for name in names:
            top = name.split(".")[0]
            if importlib.util.find_spec(top) is None:
                print(f"ERR {path}:{top}")
                sys.exit(1)
print("OK")
