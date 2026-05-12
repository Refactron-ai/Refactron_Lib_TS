"""Re-parse each path with ast. Print "OK" on success, "ERR <path>:<msg>" on first failure."""
import ast
import sys

for path in sys.argv[1:]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            ast.parse(f.read(), filename=path)
    except SyntaxError as e:
        print(f"ERR {path}:SyntaxError: {e.msg} (line {e.lineno})")
        sys.exit(1)
print("OK")
